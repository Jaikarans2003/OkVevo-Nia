import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { loadHermesDotenvIntoProcess, applyPackEnv, loadPackEnvFile } from './okvevo-env'

test('shell wins; hermes home fills; unpackaged repo fills remaining', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-env-'))
  const hermesHome = path.join(root, 'hermes-home')
  const repoEnv = path.join(root, 'repo.env')

  fs.mkdirSync(hermesHome)
  fs.writeFileSync(path.join(hermesHome, '.env'), 'OKVEVO_WEB_ORIGIN=https://from-home.example\nHOME_ONLY=1\n')
  fs.writeFileSync(repoEnv, 'OKVEVO_WEB_ORIGIN=https://from-repo.example\nREPO_ONLY=1\nSHELL_KEY=from-repo\n')

  const env: NodeJS.ProcessEnv = { SHELL_KEY: 'from-shell' }
  const loaded = loadHermesDotenvIntoProcess({ hermesHome, unpackagedRepoEnv: repoEnv, env })

  assert.equal(env.OKVEVO_WEB_ORIGIN, 'https://from-home.example')
  assert.equal(env.HOME_ONLY, '1')
  assert.equal(env.REPO_ONLY, '1')
  assert.equal(env.SHELL_KEY, 'from-shell')
  assert.equal(loaded.length, 2)
})

test('packaged path skips repo env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-env-'))
  const hermesHome = path.join(root, 'hermes-home')
  const repoEnv = path.join(root, 'repo.env')

  fs.mkdirSync(hermesHome)
  fs.writeFileSync(repoEnv, 'REPO_ONLY=1\n')

  const env: NodeJS.ProcessEnv = {}
  loadHermesDotenvIntoProcess({ hermesHome, unpackagedRepoEnv: null, env })

  assert.equal(env.REPO_ONLY, undefined)
})

test('pack-env fills only unset keys after dotenv', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-pack-env-'))
  const file = path.join(root, 'okvevo-pack-env.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      OKVEVO_WEB_ORIGIN: 'https://from-pack.example',
      NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging',
      NIA_UPDATE_CHANNEL: 'latest'
    })
  )

  const env: NodeJS.ProcessEnv = { OKVEVO_WEB_ORIGIN: 'https://from-home.example' }
  const applied = applyPackEnv(loadPackEnvFile(file), env)

  assert.equal(env.OKVEVO_WEB_ORIGIN, 'https://from-home.example')
  assert.equal(env.NIA_UPDATE_FEED_URL, 'https://releases.okvevo.com/staging')
  assert.equal(env.NIA_UPDATE_CHANNEL, 'latest')
  assert.deepEqual(applied.sort(), ['NIA_UPDATE_CHANNEL', 'NIA_UPDATE_FEED_URL'])

  fs.rmSync(root, { recursive: true, force: true })
})
