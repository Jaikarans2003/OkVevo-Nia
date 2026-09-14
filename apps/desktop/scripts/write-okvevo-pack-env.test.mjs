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
  formatMissingPackSecrets,
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
