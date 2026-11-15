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
    OKVEVO_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging/'
  })
  assert.equal(payload.OKVEVO_WEB_ORIGIN, 'https://portal.example')
  assert.equal(payload.OKVEVO_UPDATE_FEED_URL, 'https://releases.okvevo.com/staging')
  assert.equal(payload.OKVEVO_UPDATE_CHANNEL, 'latest')
})

test('--require exits 1 with no secrets', () => {
  const env = { ...process.env }
  for (const name of REQUIRED_PACK_SECRETS) {
    delete env[name]
  }
  const result = spawnSync(process.execPath, [script, '--require'], { env, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /fail-closed/)
  assert.match(formatMissingPackSecrets(['OKVEVO_WEB_ORIGIN']), /okvevo-feed-urls/)
})

function shapedPackEnv(overrides = {}) {
  return {
    OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com',
    OKVEVO_UPDATE_FEED_URL: 'https://releases.okvevo.com',
    ...overrides
  }
}

test('pack secret shapes accept https origin and feed path', () => {
  assert.deepEqual(invalidPackSecretShapes({}), [])
  assert.deepEqual(invalidPackSecretShapes(shapedPackEnv()), [])
  assert.deepEqual(
    invalidPackSecretShapes(
      shapedPackEnv({
        OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com/',
        OKVEVO_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging/'
      })
    ),
    []
  )
})

test('pack secret shapes reject a host without a scheme or a path on the origin', () => {
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
    invalidPackSecretShapes(shapedPackEnv({ OKVEVO_UPDATE_FEED_URL: 'releases.okvevo.com' })),
    ['OKVEVO_UPDATE_FEED_URL']
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

test('writePackEnvFile writes runtime keys only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-pack-env-'))
  const out = path.join(dir, 'okvevo-pack-env.json')
  writePackEnvFile(buildPackEnvPayload(shapedPackEnv()), out)
  const payload = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.deepEqual(Object.keys(payload).sort(), [
    'OKVEVO_UPDATE_CHANNEL',
    'OKVEVO_UPDATE_FEED_URL',
    'OKVEVO_WEB_ORIGIN'
  ])
})
