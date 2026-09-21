import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import {
  formatMissingReleaseSecrets,
  missingReleaseSecrets,
  REQUIRED_FEED_SECRETS,
  REQUIRED_RELEASE_SECRETS,
  unsignedPackAllowed
} from './require-release-secrets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'require-release-secrets.mjs')

test('empty env is missing every required secret', () => {
  const missing = missingReleaseSecrets({})
  assert.deepEqual(missing, REQUIRED_RELEASE_SECRETS)
  assert.ok(REQUIRED_RELEASE_SECRETS.includes('CSC_LINK'))
  assert.ok(REQUIRED_RELEASE_SECRETS.includes('WIN_CSC_LINK'))
  assert.ok(REQUIRED_RELEASE_SECRETS.includes('RELEASES_S3_BUCKET'))
})

test('whitespace-only values still count as missing', () => {
  const env = Object.fromEntries(REQUIRED_RELEASE_SECRETS.map(name => [name, '  ']))
  assert.deepEqual(missingReleaseSecrets(env), REQUIRED_RELEASE_SECRETS)
})

test('complete env is empty missing list', () => {
  const env = Object.fromEntries(REQUIRED_RELEASE_SECRETS.map(name => [name, 'x']))
  assert.deepEqual(missingReleaseSecrets(env), [])
})

test('CLI exits 1 with no secrets — the safety mechanism itself', () => {
  const env = { ...process.env }
  for (const name of REQUIRED_RELEASE_SECRETS) {
    delete env[name]
  }

  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /fail-closed/)
  assert.match(result.stderr, /CSC_LINK/)
  assert.doesNotMatch(result.stdout + result.stderr, /latest-mac\.yml published/i)
})

test('CLI exits 0 when every secret is set', () => {
  const env = { ...process.env }
  for (const name of REQUIRED_RELEASE_SECRETS) {
    env[name] = 'placeholder'
  }

  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /present/)
})

test('error copy names the finish doc', () => {
  assert.match(formatMissingReleaseSecrets(['CSC_LINK']), /FINISH-SIGNED-RELEASE\.md/)
})

test('unsigned pack only requires feed secrets', () => {
  assert.deepEqual(missingReleaseSecrets({}, { allowUnsigned: true }), REQUIRED_FEED_SECRETS)
  const feedOnly = Object.fromEntries(REQUIRED_FEED_SECRETS.map(name => [name, 'x']))
  assert.deepEqual(missingReleaseSecrets(feedOnly, { allowUnsigned: true }), [])
  assert.ok(missingReleaseSecrets(feedOnly).includes('CSC_LINK'))
})

test('NIA_ALLOW_UNSIGNED and --allow-unsigned enable the unsigned path', () => {
  assert.equal(unsignedPackAllowed({}, []), false)
  assert.equal(unsignedPackAllowed({ NIA_ALLOW_UNSIGNED: '1' }, []), true)
  assert.equal(unsignedPackAllowed({ NIA_ALLOW_UNSIGNED: 'true' }, []), true)
  assert.equal(unsignedPackAllowed({ NIA_ALLOW_UNSIGNED: 'TRUE' }, []), true)
  assert.equal(unsignedPackAllowed({ NIA_ALLOW_UNSIGNED: '0' }, []), false)
  assert.equal(unsignedPackAllowed({}, ['--allow-unsigned']), true)
})

test('CLI --allow-unsigned exits 0 with only feed secrets', () => {
  const env = { ...process.env }
  for (const name of REQUIRED_RELEASE_SECRETS) {
    delete env[name]
  }
  for (const name of REQUIRED_FEED_SECRETS) {
    env[name] = 'placeholder'
  }

  const result = spawnSync(process.execPath, [script, '--allow-unsigned'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /unsigned pack allowed/)
})
