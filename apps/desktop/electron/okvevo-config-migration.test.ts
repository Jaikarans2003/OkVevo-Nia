import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'

import {
  DESKTOP_PLATFORM_HINT_APPEND,
  makeOkvevoSoul,
  migrateOkvevoHermesHome,
  NIA_DEFAULT_SOUL,
  planConfigChanges,
  shouldReplaceSoul,
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
