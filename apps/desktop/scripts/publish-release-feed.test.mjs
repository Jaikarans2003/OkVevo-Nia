import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  STABLE_MAC_NAME,
  STABLE_WIN_NAME,
  artifactNameFor,
  parseElectronBuilderYml,
  promoteInternalToLatest,
  s3Uri,
  syncFeed
} from './publish-release-feed.mjs'

test('parse yml version and path', () => {
  const parsed = parseElectronBuilderYml(
    ['version: 0.17.42', 'files:', '  - url: Nia-0.17.42-mac-arm64.zip', 'path: Nia-0.17.42-mac-arm64.zip'].join('\n')
  )
  assert.equal(parsed.version, '0.17.42')
  assert.equal(parsed.path, 'Nia-0.17.42-mac-arm64.zip')
  assert.deepEqual(artifactNameFor('0.17.42', 'mac-dmg'), 'Nia-0.17.42-mac-arm64.dmg')
  assert.deepEqual(artifactNameFor('0.17.42', 'win-nsis'), 'Nia-0.17.42-win-x64.exe')
  assert.equal(s3Uri('bucket', 'staging/latest.yml'), 's3://bucket/staging/latest.yml')
})

test('production sync renames latest yml to internal and excludes latest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-feed-'))
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), 'version: 0.17.1\n')
  fs.writeFileSync(path.join(dir, 'latest.yml'), 'version: 0.17.1\n')
  fs.writeFileSync(path.join(dir, 'Nia-0.17.1-mac-arm64.dmg'), 'x')
  const calls = []
  syncFeed({
    feedDir: dir,
    bucket: 'releases',
    mode: 'production-internal',
    aws: args => {
      calls.push(args)
      return ''
    }
  })
  assert.ok(fs.existsSync(path.join(dir, 'internal-mac.yml')))
  assert.ok(fs.existsSync(path.join(dir, 'internal.yml')))
  const syncArgs = calls[0]
  assert.ok(syncArgs.includes('internal-mac.yml'))
  assert.ok(syncArgs.includes('--exclude'))
  assert.ok(syncArgs.includes('latest*.yml'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('staging sync keeps latest yml names under prefix and copies stable names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-feed-'))
  fs.writeFileSync(
    path.join(dir, 'latest-mac.yml'),
    'version: 0.17.8\npath: Nia-0.17.8-mac-arm64.zip\n'
  )
  fs.writeFileSync(
    path.join(dir, 'latest.yml'),
    'version: 0.17.8\npath: Nia-0.17.8-win-x64.exe\n'
  )
  fs.writeFileSync(path.join(dir, 'Nia-0.17.8-mac-arm64.dmg'), 'x')
  fs.writeFileSync(path.join(dir, 'Nia-0.17.8-win-x64.exe'), 'x')
  const calls = []
  syncFeed({
    feedDir: dir,
    bucket: 'releases',
    prefix: 'staging',
    mode: 'staging',
    aws: args => {
      calls.push(args)
      return ''
    }
  })
  assert.ok(calls[0].includes('s3://releases/staging/'))
  assert.ok(calls[0].includes('latest*.yml'))
  assert.ok(!calls[0].includes('internal.yml'))
  assert.ok(
    calls.some(
      a =>
        a.includes(path.join(dir, 'Nia-0.17.8-mac-arm64.dmg')) &&
        a.includes(`s3://releases/staging/${STABLE_MAC_NAME}`)
    )
  )
  assert.ok(
    calls.some(
      a =>
        a.includes(path.join(dir, 'Nia-0.17.8-win-x64.exe')) &&
        a.includes(`s3://releases/staging/${STABLE_WIN_NAME}`)
    )
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('promote copies yml to latest and artifacts to stable names', () => {
  const calls = []
  const objects = {
    'internal-mac.yml': 'version: 0.17.9\npath: Nia-0.17.9-mac-arm64.zip\n',
    'internal.yml': 'version: 0.17.9\npath: Nia-0.17.9-win-x64.exe\n'
  }
  const result = promoteInternalToLatest({
    bucket: 'releases',
    aws: args => {
      calls.push(args)
      return ''
    },
    readObject: key => objects[key]
  })
  assert.equal(result.version, '0.17.9')
  assert.equal(result.stableMac, STABLE_MAC_NAME)
  assert.equal(result.stableWin, STABLE_WIN_NAME)
  assert.ok(calls.some(a => a.includes('s3://releases/latest-mac.yml')))
  assert.ok(calls.some(a => a.includes(`s3://releases/${STABLE_MAC_NAME}`) && a.includes('--copy-props') && a.includes('none')))
  assert.ok(calls.some(a => a.includes(`s3://releases/${STABLE_WIN_NAME}`) && a.includes('--copy-props') && a.includes('none')))
})
