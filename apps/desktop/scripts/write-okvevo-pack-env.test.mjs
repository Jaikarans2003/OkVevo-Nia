import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import {
  REQUIRED_PACK_SECRETS,
  buildPackEnvPayload,
  formatInvalidPackSecrets,
  formatMissingPackSecrets,
  invalidPackSecretShapes,
  missingPackSecrets,
  writePackEnvFile
} from './write-okvevo-pack-env.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'write-okvevo-pack-env.mjs')

test('empty env is missing every required pack secret', () => {
  assert.deepEqual(missingPackSecrets({}), REQUIRED_PACK_SECRETS)
})

test('complete env is empty missing list', () => {
  const env = Object.fromEntries(REQUIRED_PACK_SECRETS.map(name => [name, 'x']))
  assert.deepEqual(missingPackSecrets(env), [])
})

test('payload defaults channel to latest and strips trailing slashes', () => {
  const payload = buildPackEnvPayload({
    OKVEVO_WEB_ORIGIN: 'https://portal.example/',
    NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging/'
  })
  assert.equal(payload.OKVEVO_WEB_ORIGIN, 'https://portal.example')
  assert.equal(payload.NIA_UPDATE_FEED_URL, 'https://releases.okvevo.com/staging')
  assert.equal(payload.NIA_UPDATE_CHANNEL, 'latest')
})

test('--require exits 1 with no secrets', () => {
  const env = { ...process.env }
  for (const name of REQUIRED_PACK_SECRETS) {
    delete env[name]
  }
  const result = spawnSync(process.execPath, [script, '--require'], { env, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /fail-closed/)
  assert.match(formatMissingPackSecrets(['OKVEVO_WEB_ORIGIN']), /Do not hardcode/)
})

function shapedPackEnv(overrides = {}) {
  return {
    OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com',
    NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com',
    VITE_OKVEVO_FIREBASE_API_KEY: 'k',
    VITE_OKVEVO_FIREBASE_AUTH_DOMAIN: 'auth.okvevo.com',
    VITE_OKVEVO_FIREBASE_PROJECT_ID: 'p',
    VITE_OKVEVO_FIREBASE_STORAGE_BUCKET: 'b',
    VITE_OKVEVO_FIREBASE_MESSAGING_SENDER_ID: 's',
    VITE_OKVEVO_FIREBASE_APP_ID: 'a',
    ...overrides
  }
}

test('pack secret shapes accept https origin, feed path, and bare auth domain', () => {
  assert.deepEqual(invalidPackSecretShapes({}), [])
  assert.deepEqual(invalidPackSecretShapes(shapedPackEnv()), [])
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({
      OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com/',
      NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging/'
    })),
    []
  )
})

test('pack secret shapes reject a host without a scheme, a path on the origin, and a scheme on the auth domain', () => {
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ OKVEVO_WEB_ORIGIN: 'www.okvevo.com' })),
    ['OKVEVO_WEB_ORIGIN']
  )
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ OKVEVO_WEB_ORIGIN: 'http://www.okvevo.com' })),
    ['OKVEVO_WEB_ORIGIN']
  )
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com/login' })),
    ['OKVEVO_WEB_ORIGIN']
  )
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com?x=1' })),
    ['OKVEVO_WEB_ORIGIN']
  )
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com#frag' })),
    ['OKVEVO_WEB_ORIGIN']
  )
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ NIA_UPDATE_FEED_URL: 'releases.okvevo.com' })),
    ['NIA_UPDATE_FEED_URL']
  )
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging?x=1' })),
    ['NIA_UPDATE_FEED_URL']
  )
  assert.deepEqual(
    invalidPackSecretShapes(shapedPackEnv({ VITE_OKVEVO_FIREBASE_AUTH_DOMAIN: 'https://auth.okvevo.com' })),
    ['VITE_OKVEVO_FIREBASE_AUTH_DOMAIN']
  )
  const message = formatInvalidPackSecrets(['OKVEVO_WEB_ORIGIN'])
  assert.match(message, /OKVEVO_WEB_ORIGIN/)
  assert.equal(message.includes('www.okvevo.com'), false)
})

test('--require exits 1 when the origin is not an absolute https URL and does not print the value', () => {
  const badOrigin = 'www.okvevo.com'
  const env = { ...process.env, ...shapedPackEnv({ OKVEVO_WEB_ORIGIN: badOrigin }) }
  const result = spawnSync(process.execPath, [script, '--require'], { env, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /OKVEVO_WEB_ORIGIN/)
  assert.equal(result.stderr.includes(badOrigin), false)
  assert.equal(result.stdout.includes(badOrigin), false)
})

test('writePackEnvFile emits JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-env-'))
  const out = path.join(dir, 'okvevo-pack-env.json')
  writePackEnvFile(
    { OKVEVO_WEB_ORIGIN: 'https://a.example', NIA_UPDATE_FEED_URL: 'https://b.example', NIA_UPDATE_CHANNEL: 'latest' },
    out
  )
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.equal(parsed.OKVEVO_WEB_ORIGIN, 'https://a.example')
  fs.rmSync(dir, { recursive: true, force: true })
})
