import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { dump as stringifyYaml } from 'js-yaml'
import { test } from 'vitest'

import {
  DESKTOP_PLATFORM_HINT_APPEND,
  legacyOkvevoSouls,
  loadOkvevoDefaults,
  loadOkvevoIdentity,
  makeOkvevoSoul,
  migrateOkvevoHermesHome,
  type MigrationFs,
  planConfigChanges,
  provisionOkvevoProfile,
  readFirstText,
  shouldReplaceSoul,
  watchOkvevoManagedConfig
} from './okvevo-config-migration'

const UPSTREAM_SOUL =
  'You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask.\n'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const NIA_PERSONALITY_SOUL = fs.readFileSync(path.join(REPO_ROOT, 'okvevo/config/legacy-souls/nia-personality.md'), 'utf8')

// What builds before PR 1.4 wrote: the `Nous Research` → `OkVevo` swap.
const PREVIOUS_GENERATED_SOUL = UPSTREAM_SOUL.replace('Hermes Agent', 'OkVevo agent').replace('Nous Research', 'OkVevo')

test('makeOkvevoSoul swaps identity phrases only and restores upstream', () => {
  const generated = makeOkvevoSoul(UPSTREAM_SOUL)

  assert.equal(generated.startsWith('You are OkVevo agent, made by OkVevo.'), true)
  assert.doesNotMatch(generated, /\bNia\b|Hermes Agent|Nous Research/)
  assert.equal(
    generated.replaceAll('OkVevo agent', 'Hermes Agent').replaceAll('made by OkVevo', 'built by Nous Research'),
    UPSTREAM_SOUL
  )
})

test('makeOkvevoSoul and scripts/okvevo/make_soul.py write the same bytes', () => {
  const upstream = fs.readFileSync(path.join(REPO_ROOT, 'SOUL.md'), 'utf8')
  const python = process.env.HERMES_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const fromPython = execFileSync(python, [path.join(REPO_ROOT, 'scripts/okvevo/make_soul.py')], { encoding: 'utf8' })

  assert.equal(fromPython.replace(/\r\n/g, '\n'), makeOkvevoSoul(upstream))
})

test('makeOkvevoSoul fails closed when upstream rewords', () => {
  assert.throws(() => makeOkvevoSoul('You are a helpful assistant.\n'), /Hermes Agent/)
})

test('identity file names the agent OkVevo agent, made by OkVevo', () => {
  const identity = loadOkvevoIdentity()

  assert.equal(identity.agentName, 'OkVevo agent')
  assert.equal(identity.maker, 'OkVevo')
  assert.deepEqual(identity.legacySouls, [NIA_PERSONALITY_SOUL])
})

test('shouldReplaceSoul upgrades upstream and earlier OkVevo SOULs, keeps custom', () => {
  const generated = makeOkvevoSoul(UPSTREAM_SOUL)
  const legacy = legacyOkvevoSouls(UPSTREAM_SOUL)

  assert.deepEqual(legacy, [PREVIOUS_GENERATED_SOUL, NIA_PERSONALITY_SOUL])
  assert.equal(shouldReplaceSoul('', generated, UPSTREAM_SOUL, legacy), true)
  assert.equal(shouldReplaceSoul(UPSTREAM_SOUL, generated, UPSTREAM_SOUL, legacy), true)
  assert.equal(shouldReplaceSoul(NIA_PERSONALITY_SOUL, generated, UPSTREAM_SOUL, legacy), true)
  assert.equal(shouldReplaceSoul(`\uFEFF${PREVIOUS_GENERATED_SOUL.replace(/\n/g, '\r\n')}`, generated, UPSTREAM_SOUL, legacy), true)
  assert.equal(shouldReplaceSoul(generated, generated, UPSTREAM_SOUL, legacy), false)
  assert.equal(shouldReplaceSoul('You are my custom bot.\n', generated, UPSTREAM_SOUL, legacy), false)
  assert.equal(shouldReplaceSoul(`${PREVIOUS_GENERATED_SOUL}Also be terse.\n`, generated, UPSTREAM_SOUL, legacy), false)
})

test('planConfigChanges is idempotent after the first rewrite', () => {
  const first = planConfigChanges({}, { skillsDir: '/repo/okvevo/skills' })

  assert.equal(first.changes.length > 0, true)
  assert.equal((first.next.model as { provider: string }).provider, 'okvevo')
  assert.equal((first.next.image_gen as { provider: string }).provider, 'okvevo')
  assert.equal((first.next.video_gen as { provider: string }).provider, 'okvevo')
  assert.equal((first.next.web as { backend: string }).backend, 'okvevo')
  assert.deepEqual((first.next.plugins as { enabled: string[] }).enabled, ['okvevo'])
  assert.equal(
    ((first.next.platform_hints as { desktop: { append: string } }).desktop.append),
    DESKTOP_PLATFORM_HINT_APPEND
  )

  const second = planConfigChanges(first.next, { skillsDir: '/repo/okvevo/skills' })

  assert.deepEqual(second.changes, [])
})

test('planConfigChanges rewrites openrouter and drops nia-public-guard', () => {
  const { changes, next } = planConfigChanges({
    model: { provider: 'openrouter', model: 'keep-me' },
    plugins: { enabled: ['nia-public-guard', 'weather'] },
    web: { backend: 'tavily' }
  })

  assert.equal((next.model as { provider: string; model: string }).model, 'keep-me')
  assert.ok(changes.some(line => line.includes('openrouter→okvevo')))
  assert.deepEqual((next.plugins as { enabled: string[] }).enabled, ['weather', 'okvevo'])
})

test('migrateOkvevoHermesHome covers root + profiles, backs up, skips custom soul', () => {
  const files = new Map<string, string>()
  const logs: string[] = []
  const writes: string[] = []
  const root = '/tmp/hermes-home'
  const other = path.join(root, 'profiles', 'work')
  const old = path.join(root, 'profiles', 'old-bot')

  files.set(path.join(root, 'SOUL.md'), NIA_PERSONALITY_SOUL)
  files.set(path.join(root, 'config.yaml'), 'model:\n  provider: openrouter\n')
  files.set(path.join(other, 'SOUL.md'), 'You are my custom bot.\n')
  files.set(path.join(other, 'config.yaml'), 'model:\n  provider: openai\n')
  files.set(path.join(old, 'SOUL.md'), PREVIOUS_GENERATED_SOUL)

  const io: MigrationFs = {
    existsSync: target => files.has(target) || [...files.keys()].some(key => key.startsWith(`${target}/`)),
    readFileSync: (target, _encoding) => {
      const text = files.get(target)

      if (text === undefined) {
        throw new Error(`missing ${target}`)
      }

      return text
    },
    writeFileSync: (target, data) => {
      writes.push(target)
      files.set(target, data)
    },
    mkdirSync: () => undefined,
    copyFileSync: (src, dest) => {
      files.set(dest, files.get(src) ?? '')
    },
    readdirSync: target => {
      if (target === path.join(root, 'profiles')) {
        return ['work', 'old-bot']
      }

      return []
    }
  }

  migrateOkvevoHermesHome({
    hermesHome: root,
    upstreamSoul: UPSTREAM_SOUL,
    skillsDir: '/repo/okvevo/skills',
    log: line => logs.push(line),
    fsImpl: io
  })

  const generated = makeOkvevoSoul(UPSTREAM_SOUL)
  assert.equal(files.get(path.join(root, 'SOUL.md')), generated)
  assert.equal(files.get(path.join(root, 'SOUL.md.okvevo-migrate.bak')), NIA_PERSONALITY_SOUL)
  assert.equal(files.get(path.join(old, 'SOUL.md')), generated)
  assert.equal(files.get(path.join(old, 'SOUL.md.okvevo-migrate.bak')), PREVIOUS_GENERATED_SOUL)
  assert.equal(files.get(path.join(other, 'SOUL.md')), 'You are my custom bot.\n')
  assert.equal(files.has(path.join(other, 'SOUL.md.okvevo-migrate.bak')), false)
  assert.equal(writes.includes(path.join(other, 'SOUL.md')), false)
  assert.match(files.get(path.join(root, 'config.yaml')) ?? '', /provider: okvevo/)
  assert.match(files.get(path.join(other, 'config.yaml')) ?? '', /provider: openai/)
  assert.ok(logs.some(line => line.includes('wrote generated OkVevo SOUL')))
  assert.ok(logs.some(line => line.includes('custom SOUL kept')))

  writes.length = 0
  migrateOkvevoHermesHome({
    hermesHome: root,
    upstreamSoul: UPSTREAM_SOUL,
    skillsDir: '/repo/okvevo/skills',
    log: line => logs.push(line),
    fsImpl: io
  })
  assert.deepEqual(writes, [], 'second launch writes nothing')
})

test('planConfigChanges forces the v0.23.0 Webapp off, whatever the user config asked for', () => {
  const { next } = planConfigChanges(
    { webapp: { enabled: true, host: '0.0.0.0', port: 9120, public_url: 'https://tunnel.example' } },
    { enforce: true }
  )
  const webapp = next.webapp as { enabled: boolean; public_url: string }

  assert.equal(webapp.enabled, false)
  assert.equal(webapp.public_url, '')
})

test('planConfigChanges writes the defaults file and leaves no auto, openrouter, or nous auxiliary slot', () => {
  const defaults = loadOkvevoDefaults()
  const { next } = planConfigChanges({
    model: { provider: 'openrouter', model: 'keep-me' },
    auxiliary: { vision: { provider: 'auto', timeout: 12 }, title_generation: { provider: 'anthropic' } }
  })
  const model = next.model as { default?: string; model: string; provider: string }
  const auxiliary = next.auxiliary as Record<string, { provider?: string; timeout?: number }>

  assert.equal(model.provider, 'okvevo')
  assert.equal(model.model, 'keep-me')
  assert.equal(model.default, undefined)
  assert.equal(auxiliary.vision.provider, 'main')
  assert.equal(auxiliary.vision.timeout, 12)
  assert.equal(auxiliary.title_generation.provider, 'anthropic')
  assert.equal((next.telemetry as { shared_metrics: { enabled: boolean; send: boolean } }).shared_metrics.send, false)
  assert.equal((next.telemetry as { shared_metrics: { offer_version: number } }).shared_metrics.offer_version, 2)
  assert.equal((next.nous as { guest: boolean }).guest, false)

  const wantedAux = defaults.auxiliary as Record<string, { provider: string }>

  for (const [task, spec] of Object.entries(wantedAux)) {
    const provider = auxiliary[task]?.provider
    assert.equal(provider === 'auto' || provider === 'openrouter' || provider === 'nous', false, task)
    if (task !== 'title_generation') {
      assert.equal(provider, spec.provider, task)
    }
  }
})

test('planConfigChanges fills model.default only for an unset OkVevo provider', () => {
  const fresh = planConfigChanges({})
  assert.equal((fresh.next.model as { default: string }).default, 'okvevo/auto-cost')
  const dumped = stringifyYaml(fresh.next, { lineWidth: 120, noRefs: true })
  assert.match(dumped, /default: okvevo\/auto-cost/)
  assert.doesNotMatch(dumped, /provider: (auto|openrouter|nous)\b/)

  const openai = planConfigChanges({ model: { provider: 'openai' } })
  assert.equal((openai.next.model as { default?: string; provider: string }).provider, 'openai')
  assert.equal((openai.next.model as { default?: string }).default, undefined)
})

test('migrateOkvevoHermesHome writes config when SOUL.md is missing', () => {
  const files = new Map<string, string>()
  const root = '/tmp/hermes-no-soul'
  const io: MigrationFs = {
    existsSync: target => files.has(target),
    readFileSync: target => {
      const text = files.get(target)
      if (text === undefined) {throw new Error(`missing ${target}`)}

      return text
    },
    writeFileSync: (target, data) => {
      files.set(target, data)
    },
    mkdirSync: () => undefined,
    copyFileSync: () => undefined,
    readdirSync: () => []
  }

  migrateOkvevoHermesHome({ hermesHome: root, upstreamSoul: '', fsImpl: io, log: () => undefined })

  assert.match(files.get(path.join(root, 'config.yaml')) ?? '', /provider: okvevo/)
  assert.equal(files.has(path.join(root, 'SOUL.md')), false)
})

test('readFirstText keeps the checkout SOUL ahead of the packaged payload path', () => {
  const files = new Map<string, string>([
    ['/repo/SOUL.md', 'checkout soul'],
    ['/app/Resources/agent-payload/hermes-agent/SOUL.md', 'payload soul']
  ])
  const io: Pick<MigrationFs, 'existsSync' | 'readFileSync'> = {
    existsSync: target => files.has(target),
    readFileSync: target => files.get(target) ?? ''
  }

  assert.equal(
    readFirstText(['/repo/SOUL.md', '/app/Resources/agent-payload/hermes-agent/SOUL.md', '/app/Resources/agent-payload/SOUL.md'], io),
    'checkout soul'
  )
  assert.equal(
    readFirstText(['/missing/SOUL.md', '/app/Resources/agent-payload/hermes-agent/SOUL.md', '/app/Resources/agent-payload/SOUL.md'], io),
    'payload soul'
  )
})

test('provisionOkvevoProfile writes the new profile and refuses a path', () => {
  const files = new Map<string, string>()
  const root = '/tmp/hermes-provision'
  const io: MigrationFs = {
    existsSync: target => files.has(target),
    readFileSync: target => files.get(target) ?? '',
    writeFileSync: (target, data) => {
      files.set(target, data)
    },
    mkdirSync: () => undefined,
    copyFileSync: () => undefined,
    readdirSync: () => []
  }

  provisionOkvevoProfile(root, 'worker-2', { fsImpl: io, log: () => undefined })
  assert.match(files.get(path.join(root, 'profiles', 'worker-2', 'config.yaml')) ?? '', /provider: okvevo/)
  assert.throws(() => provisionOkvevoProfile(root, '../escape', { fsImpl: io }), /refusing profile name/)
})

test('provisionOkvevoProfile writes the OkVevo SOUL for a bot created after launch', () => {
  const files = new Map<string, string>()
  const root = '/tmp/hermes-provision-soul'
  const io: MigrationFs = {
    existsSync: target => files.has(target),
    readFileSync: target => files.get(target) ?? '',
    writeFileSync: (target, data) => {
      files.set(target, data)
    },
    mkdirSync: () => undefined,
    copyFileSync: () => undefined,
    readdirSync: () => []
  }

  provisionOkvevoProfile(root, 'worker-3', { fsImpl: io, log: () => undefined, upstreamSoul: UPSTREAM_SOUL })

  const soul = files.get(path.join(root, 'profiles', 'worker-3', 'SOUL.md')) ?? ''
  assert.equal(soul.includes('You are OkVevo agent, made by OkVevo.'), true)
  assert.doesNotMatch(soul, /\bNia\b|Hermes Agent|Nous Research/)

  // No upstream text (unreadable payload): config still provisions, SOUL skipped.
  const bare = new Map<string, string>()
  const ioBare: MigrationFs = { ...io, existsSync: target => bare.has(target), readFileSync: target => bare.get(target) ?? '', writeFileSync: (target, data) => { bare.set(target, data) } }
  provisionOkvevoProfile(root, 'worker-4', { fsImpl: ioBare, log: () => undefined, upstreamSoul: '  ' })
  assert.equal(bare.has(path.join(root, 'profiles', 'worker-4', 'SOUL.md')), false)
  assert.equal(bare.has(path.join(root, 'profiles', 'worker-4', 'config.yaml')), true)
})

test('planConfigChanges enforce puts any drifted managed provider back; internal keeps it', () => {
  const drifted = { model: { provider: 'anthropic', default: 'claude' }, image_gen: { provider: 'fal', model: 'fal-ai/gpt-image-2' } }
  const pub = planConfigChanges(drifted, { enforce: true }).next as {
    image_gen: { model: string; provider: string }
    model: { default: string; provider: string }
  }

  assert.equal(pub.model.provider, 'okvevo')
  assert.equal(pub.model.default, 'claude')
  assert.equal(pub.image_gen.provider, 'okvevo')
  assert.equal(pub.image_gen.model, 'fal-ai/gpt-image-2', 'image_gen.model is not managed')

  const internal = planConfigChanges(drifted, { enforce: false }).next as { model: { provider: string } }
  assert.equal(internal.model.provider, 'anthropic')

  const disabled = planConfigChanges({ plugins: { enabled: [], disabled: ['okvevo', 'x'] } }, { enforce: true }).next
  assert.deepEqual((disabled.plugins as { disabled: string[] }).disabled, ['x'])
})

async function reconcileHarness(enforce = true) {
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs')
  const os = await import('node:os')
  const root = mkdtempSync(path.join(os.tmpdir(), 'okvevo-reconcile-'))
  mkdirSync(path.join(root, 'profiles', 'cfo'), { recursive: true })
  const listeners = new Map<string, (filename: string | null) => void>()
  const lines: string[] = []
  const watcher = watchOkvevoManagedConfig({
    hermesHome: root,
    enforce,
    debounceMs: 20,
    log: line => lines.push(line),
    watchDir: (dir, onChange) => {
      listeners.set(dir, onChange)

      return { close: () => listeners.delete(dir) }
    }
  })
  const fire = (home: string) => listeners.get(home)?.('config.yaml')

  return { root, lines, watcher, fire, cleanup: () => (watcher.close(), rmSync(root, { recursive: true, force: true })) }
}

test('watchOkvevoManagedConfig: one external change writes once, then its own write is ignored', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const h = await reconcileHarness()

  try {
    const config = path.join(h.root, 'config.yaml')
    // An agent bypassing the guard with sed / a python one-liner.
    writeFileSync(config, stringifyYaml({ model: { provider: 'anthropic', default: 'claude' } }))
    h.fire(h.root)
    await h.watcher.idle()
    assert.equal(h.lines.length, 1)
    assert.match(readFileSync(config, 'utf8'), /provider: okvevo/)

    h.fire(h.root)
    await h.watcher.idle()
    assert.equal(h.lines.length, 1, 'own write must not trigger another write')
  } finally {
    h.cleanup()
  }
})

test('watchOkvevoManagedConfig: a burst of changes writes once; a profile drift is put back', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const h = await reconcileHarness()

  try {
    const profile = path.join(h.root, 'profiles', 'cfo')
    const config = path.join(profile, 'config.yaml')
    writeFileSync(config, stringifyYaml({ model: { provider: 'openai' } }))

    for (let i = 0; i < 10; i += 1) {
      h.fire(profile)
    }

    await h.watcher.idle()
    assert.equal(h.lines.length, 1)
    assert.match(readFileSync(config, 'utf8'), /provider: okvevo/)
  } finally {
    h.cleanup()
  }
})

test('watchOkvevoManagedConfig: internal builds leave a switched provider alone', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const h = await reconcileHarness(false)

  try {
    const config = path.join(h.root, 'config.yaml')
    const planned = planConfigChanges({}, {}).next
    writeFileSync(config, stringifyYaml({ ...planned, model: { provider: 'anthropic', default: 'claude' } }))
    h.fire(h.root)
    await h.watcher.idle()
    assert.equal(h.lines.length, 0)
    assert.match(readFileSync(config, 'utf8'), /provider: anthropic/)
  } finally {
    h.cleanup()
  }
})
