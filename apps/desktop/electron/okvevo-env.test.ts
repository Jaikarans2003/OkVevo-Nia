import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { applyPackEnv, loadHermesDotenvIntoProcess, loadPackEnvFile } from './okvevo-env'

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

test('pack origin overwrites wrong home .env after dotenv', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-pack-env-'))
  const hermesHome = path.join(root, 'hermes-home')
  const file = path.join(root, 'okvevo-pack-env.json')

  fs.mkdirSync(hermesHome)
  fs.writeFileSync(path.join(hermesHome, '.env'), 'OKVEVO_WEB_ORIGIN=https://from-home.example\n')
  fs.writeFileSync(
    file,
    JSON.stringify({
      OKVEVO_WEB_ORIGIN: 'https://from-pack.example',
      NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging',
      NIA_UPDATE_CHANNEL: 'latest'
    })
  )

  const env: NodeJS.ProcessEnv = {}
  loadHermesDotenvIntoProcess({ hermesHome, unpackagedRepoEnv: null, env })
  const applied = applyPackEnv(loadPackEnvFile(file), env)

  assert.equal(env.OKVEVO_WEB_ORIGIN, 'https://from-pack.example')
  assert.equal(env.NIA_UPDATE_FEED_URL, 'https://releases.okvevo.com/staging')
  assert.equal(env.NIA_UPDATE_CHANNEL, 'latest')
  assert.deepEqual(applied.sort(), ['NIA_UPDATE_CHANNEL', 'NIA_UPDATE_FEED_URL', 'OKVEVO_WEB_ORIGIN'])

  fs.rmSync(root, { recursive: true, force: true })
})

test('pack origin wins when home .env is missing the key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-pack-env-'))
  const hermesHome = path.join(root, 'hermes-home')
  const file = path.join(root, 'okvevo-pack-env.json')

  fs.mkdirSync(hermesHome)
  fs.writeFileSync(path.join(hermesHome, '.env'), 'HOME_ONLY=1\n')
  fs.writeFileSync(file, JSON.stringify({ OKVEVO_WEB_ORIGIN: 'https://from-pack.example' }))

  const env: NodeJS.ProcessEnv = {}
  loadHermesDotenvIntoProcess({ hermesHome, unpackagedRepoEnv: null, env })
  applyPackEnv(loadPackEnvFile(file), env)

  assert.equal(env.OKVEVO_WEB_ORIGIN, 'https://from-pack.example')
  assert.equal(env.HOME_ONLY, '1')

  fs.rmSync(root, { recursive: true, force: true })
})

test('pack origin wins over empty and whitespace home origin', () => {
  for (const homeOrigin of ['', '   ']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-pack-env-'))
    const hermesHome = path.join(root, 'hermes-home')
    const file = path.join(root, 'okvevo-pack-env.json')

    fs.mkdirSync(hermesHome)
    fs.writeFileSync(path.join(hermesHome, '.env'), `OKVEVO_WEB_ORIGIN=${homeOrigin}\n`)
    fs.writeFileSync(file, JSON.stringify({ OKVEVO_WEB_ORIGIN: 'https://from-pack.example' }))

    const env: NodeJS.ProcessEnv = {}
    loadHermesDotenvIntoProcess({ hermesHome, unpackagedRepoEnv: null, env })
    applyPackEnv(loadPackEnvFile(file), env)

    assert.equal(env.OKVEVO_WEB_ORIGIN, 'https://from-pack.example')

    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('empty pack origin does not clobber a home value', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-pack-env-'))
  const hermesHome = path.join(root, 'hermes-home')
  const file = path.join(root, 'okvevo-pack-env.json')

  fs.mkdirSync(hermesHome)
  fs.writeFileSync(path.join(hermesHome, '.env'), 'OKVEVO_WEB_ORIGIN=https://from-home.example\n')
  fs.writeFileSync(
    file,
    JSON.stringify({
      OKVEVO_WEB_ORIGIN: '',
      NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging'
    })
  )

  const env: NodeJS.ProcessEnv = {}
  loadHermesDotenvIntoProcess({ hermesHome, unpackagedRepoEnv: null, env })
  const applied = applyPackEnv(loadPackEnvFile(file), env)

  assert.equal(env.OKVEVO_WEB_ORIGIN, 'https://from-home.example')
  assert.equal(env.NIA_UPDATE_FEED_URL, 'https://releases.okvevo.com/staging')
  assert.deepEqual(applied, ['NIA_UPDATE_FEED_URL'])

  fs.rmSync(root, { recursive: true, force: true })
})
