import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'
import { dump as stringifyYaml } from 'js-yaml'

import {
  DESKTOP_PLATFORM_HINT_APPEND,
  loadOkvevoDefaults,
  makeOkvevoSoul,
  migrateOkvevoHermesHome,
  NIA_DEFAULT_SOUL,
  planConfigChanges,
  provisionOkvevoProfile,
  readFirstText,
  shouldReplaceSoul,
  watchOkvevoManagedConfig,
  type MigrationFs
} from './okvevo-config-migration'

const UPSTREAM_SOUL =
  'You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask.\n'

test('makeOkvevoSoul swaps identity phrases only and restores upstream', () => {
  const generated = makeOkvevoSoul(UPSTREAM_SOUL)

  assert.equal(generated.includes('You are OkVevo agent, built by OkVevo.'), true)
  assert.equal(generated.includes('Hermes Agent'), false)
  assert.equal(generated.includes('Nous Research'), false)
  assert.equal(generated.replaceAll('OkVevo agent', 'Hermes Agent').replaceAll('OkVevo', 'Nous Research'), UPSTREAM_SOUL)
})

test('makeOkvevoSoul fails closed when upstream rewords', () => {
  assert.throws(() => makeOkvevoSoul('You are a helpful assistant.\n'), /Hermes Agent/)
})

test('shouldReplaceSoul upgrades upstream and OkVevo defaults, keeps custom', () => {
  const generated = makeOkvevoSoul(UPSTREAM_SOUL)

  assert.equal(shouldReplaceSoul('', generated, UPSTREAM_SOUL), true)
  assert.equal(shouldReplaceSoul(UPSTREAM_SOUL, generated, UPSTREAM_SOUL), true)
  assert.equal(shouldReplaceSoul(NIA_DEFAULT_SOUL, generated, UPSTREAM_SOUL), true)
  assert.equal(shouldReplaceSoul(generated, generated, UPSTREAM_SOUL), false)
  assert.equal(shouldReplaceSoul('You are my custom bot.\n', generated, UPSTREAM_SOUL), false)
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
  const root = '/tmp/hermes-home'
  const other = path.join(root, 'profiles', 'work')

  files.set(path.join(root, 'SOUL.md'), NIA_DEFAULT_SOUL)
  files.set(path.join(root, 'config.yaml'), 'model:\n  provider: openrouter\n')
  files.set(path.join(other, 'SOUL.md'), 'You are my custom bot.\n')
  files.set(path.join(other, 'config.yaml'), 'model:\n  provider: openai\n')

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
      files.set(target, data)
    },
    mkdirSync: () => undefined,
    copyFileSync: (src, dest) => {
      files.set(dest, files.get(src) ?? '')
    },
    readdirSync: target => {
      if (target === path.join(root, 'profiles')) {
        return ['work']
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

  assert.equal(files.get(path.join(root, 'SOUL.md'))?.startsWith('You are OkVevo agent, built by OkVevo.'), true)
  assert.equal(files.has(path.join(root, 'SOUL.md.okvevo-migrate.bak')), true)
  assert.equal(files.get(path.join(other, 'SOUL.md')), 'You are my custom bot.\n')
  assert.match(files.get(path.join(root, 'config.yaml')) ?? '', /provider: okvevo/)
  assert.match(files.get(path.join(other, 'config.yaml')) ?? '', /provider: openai/)
  assert.ok(logs.some(line => line.includes('wrote generated OkVevo SOUL')))
  assert.ok(logs.some(line => line.includes('custom SOUL kept')))

  const before = files.get(path.join(root, 'config.yaml'))
  migrateOkvevoHermesHome({
    hermesHome: root,
    upstreamSoul: UPSTREAM_SOUL,
    skillsDir: '/repo/okvevo/skills',
    log: line => logs.push(line),
    fsImpl: io
  })
  assert.equal(files.get(path.join(root, 'config.yaml')), before)
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
      if (text === undefined) throw new Error(`missing ${target}`)
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
