import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  CACHE_CONTROL_IMMUTABLE,
  CACHE_CONTROL_NO_STORE,
  CATALOG_KEEP_N,
  RELEASES_JSON_KEY,
  STABLE_MAC_NAME,
  STABLE_WIN_NAME,
  archiveFeed,
  artifactNameFor,
  isPublishedVersion,
  loadCatalog,
  parseElectronBuilderYml,
  publishPointers,
  retainCatalog,
  s3Uri,
  sha512Base64,
  siblingBlockmapName,
  syncFeed,
  upsertReleasesJson,
  verifyArchivedVersion
} from './publish-release-feed.mjs'

function keyFromS3(uri) {
  return String(uri).replace(/^s3:\/\/[^/]+\//, '')
}

function destArg(args) {
  const s3s = args.filter(a => String(a).startsWith('s3://'))
  if (args[3] === '-') return null
  return s3s.length ? keyFromS3(s3s[s3s.length - 1]) : null
}

function cacheControlOf(args) {
  const i = args.indexOf('--cache-control')
  return i >= 0 ? args[i + 1] : ''
}

function createMemoryAws(store) {
  return args => {
    if (args[0] !== 's3' || args[1] !== 'cp') {
      throw new Error(`unexpected aws ${args.join(' ')}`)
    }
    const src = args[2]
    const dest = args[3]
    if (src.startsWith('s3://') && dest === '-') {
      const key = keyFromS3(src)
      if (!Object.prototype.hasOwnProperty.call(store, key)) {
        throw new Error(`NoSuchKey ${key}`)
      }
      const val = store[key]
      return Buffer.isBuffer(val) ? val.toString('utf8') : String(val)
    }
    if (src.startsWith('s3://') && dest.startsWith('s3://')) {
      const from = keyFromS3(src)
      const to = keyFromS3(dest)
      if (!Object.prototype.hasOwnProperty.call(store, from)) {
        throw new Error(`NoSuchKey ${from}`)
      }
      store[to] = store[from]
      return ''
    }
    if (src.startsWith('s3://') && !dest.startsWith('s3://')) {
      const key = keyFromS3(src)
      if (!Object.prototype.hasOwnProperty.call(store, key)) {
        throw new Error(`NoSuchKey ${key}`)
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, store[key])
      return ''
    }
    const to = keyFromS3(dest)
    store[to] = fs.readFileSync(src)
    return ''
  }
}

function writePlatformDir(version, platform) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-feed-'))
  if (platform === 'mac' || platform === 'both') {
    const zip = `zip-${version}`
    const dmg = `dmg-${version}`
    fs.writeFileSync(path.join(dir, artifactNameFor(version, 'mac-zip')), zip)
    fs.writeFileSync(path.join(dir, `${artifactNameFor(version, 'mac-zip')}.blockmap`), 'bm-zip')
    fs.writeFileSync(path.join(dir, artifactNameFor(version, 'mac-dmg')), dmg)
    fs.writeFileSync(
      path.join(dir, 'latest-mac.yml'),
      [
        `version: ${version}`,
        'files:',
        `  - url: ${artifactNameFor(version, 'mac-zip')}`,
        `    sha512: ${sha512Base64(Buffer.from(zip))}`,
        `    size: ${zip.length}`,
        `path: ${artifactNameFor(version, 'mac-zip')}`,
        `sha512: ${sha512Base64(Buffer.from(zip))}`
      ].join('\n')
    )
  }
  if (platform === 'win' || platform === 'both') {
    const exe = `exe-${version}`
    fs.writeFileSync(path.join(dir, artifactNameFor(version, 'win-nsis')), exe)
    fs.writeFileSync(path.join(dir, `${artifactNameFor(version, 'win-nsis')}.blockmap`), 'bm-exe')
    fs.writeFileSync(
      path.join(dir, 'latest.yml'),
      [
        `version: ${version}`,
        'files:',
        `  - url: ${artifactNameFor(version, 'win-nsis')}`,
        `    sha512: ${sha512Base64(Buffer.from(exe))}`,
        `    size: ${exe.length}`,
        `path: ${artifactNameFor(version, 'win-nsis')}`
      ].join('\n')
    )
  }
  return dir
}

test('parse yml version, path, and files', () => {
  const parsed = parseElectronBuilderYml(
    [
      'version: 0.17.42',
      'files:',
      '  - url: Nia-0.17.42-mac-arm64.zip',
      '    sha512: abc',
      '    size: 9',
      'path: Nia-0.17.42-mac-arm64.zip'
    ].join('\n')
  )
  assert.equal(parsed.version, '0.17.42')
  assert.equal(parsed.path, 'Nia-0.17.42-mac-arm64.zip')
  assert.equal(parsed.files[0].sha512, 'abc')
  assert.equal(parsed.files[0].size, 9)
  assert.deepEqual(artifactNameFor('0.17.42', 'mac-dmg'), 'Nia-0.17.42-mac-arm64.dmg')
  assert.deepEqual(artifactNameFor('0.17.42', 'win-nsis'), 'Nia-0.17.42-win-x64.exe')
  assert.equal(s3Uri('bucket', 'staging/latest.yml'), 's3://bucket/staging/latest.yml')
  assert.equal(siblingBlockmapName('Nia-0.17.42-mac-arm64.zip'), 'Nia-0.17.42-mac-arm64.zip.blockmap')
  assert.equal(siblingBlockmapName('a.zip.blockmap'), '')
})

test('staging sync keeps latest yml names under prefix and copies stable names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-feed-'))
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), 'version: 0.17.8\npath: Nia-0.17.8-mac-arm64.zip\n')
  fs.writeFileSync(path.join(dir, 'latest.yml'), 'version: 0.17.8\npath: Nia-0.17.8-win-x64.exe\n')
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
  fs.rmSync(dir, { recursive: true, force: true })
})

test('syncFeed rejects production-internal', () => {
  assert.throws(
    () =>
      syncFeed({
        feedDir: '.',
        bucket: 'releases',
        mode: 'production-internal',
        aws: () => ''
      }),
    /must be staging/
  )
})

test('archiveFeed uploads binaries/blockmaps immutable and yml under versions/{ver}/, not root latest', () => {
  const version = '0.17.15'
  const dir = writePlatformDir(version, 'mac')
  const store = {}
  const calls = []
  const aws = args => {
    calls.push(args)
    return createMemoryAws(store)(args)
  }
  archiveFeed({ feedDir: dir, bucket: 'releases', platform: 'mac', version, aws })
  assert.ok(store[`Nia-${version}-mac-arm64.dmg`])
  assert.ok(store[`Nia-${version}-mac-arm64.zip`])
  assert.ok(store[`Nia-${version}-mac-arm64.zip.blockmap`])
  assert.ok(store[`versions/${version}/latest-mac.yml`])
  assert.equal(store['latest-mac.yml'], undefined)
  assert.equal(store['latest.yml'], undefined)
  assert.equal(store[RELEASES_JSON_KEY], undefined)
  const dmgCall = calls.find(a => destArg(a) === `Nia-${version}-mac-arm64.dmg`)
  assert.equal(cacheControlOf(dmgCall), CACHE_CONTROL_IMMUTABLE)
  const ymlCall = calls.find(a => destArg(a) === `versions/${version}/latest-mac.yml`)
  assert.equal(cacheControlOf(ymlCall), CACHE_CONTROL_NO_STORE)
  assert.ok(!calls.some(a => a.includes('s3 rm') || a.includes('delete-object')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('archiveFeed unpublished retry re-uploads the platform full set', () => {
  const version = '0.17.16'
  const dir = writePlatformDir(version, 'win')
  const store = { [`Nia-${version}-win-x64.exe`]: Buffer.from('stale') }
  archiveFeed({
    feedDir: dir,
    bucket: 'releases',
    platform: 'win',
    version,
    aws: createMemoryAws(store)
  })
  assert.equal(Buffer.from(store[`Nia-${version}-win-x64.exe`]).toString(), 'exe-0.17.16')
  assert.ok(store[`Nia-${version}-win-x64.exe.blockmap`])
  assert.ok(store[`versions/${version}/latest.yml`])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('archiveFeed refuses a version listed in releases.json or root latest*.yml', () => {
  const version = '0.17.15'
  const dir = writePlatformDir(version, 'mac')
  const inCatalog = {}
  inCatalog[RELEASES_JSON_KEY] = Buffer.from(JSON.stringify([{ version, status: 'current' }]))
  assert.throws(
    () =>
      archiveFeed({
        feedDir: dir,
        bucket: 'releases',
        platform: 'mac',
        version,
        aws: createMemoryAws(inCatalog)
      }),
    /refusing to overwrite published version/
  )

  const inYml = { 'latest.yml': Buffer.from(`version: ${version}\n`) }
  assert.throws(
    () =>
      archiveFeed({
        feedDir: dir,
        bucket: 'releases',
        platform: 'mac',
        version,
        aws: createMemoryAws(inYml)
      }),
    /refusing to overwrite published version/
  )

  const inMacYml = { 'latest-mac.yml': Buffer.from(`version: ${version}\n`) }
  assert.throws(
    () =>
      archiveFeed({
        feedDir: dir,
        bucket: 'releases',
        platform: 'mac',
        version,
        aws: createMemoryAws(inMacYml)
      }),
    /refusing to overwrite published version/
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadCatalog missing is empty; invalid JSON throws', () => {
  assert.deepEqual(loadCatalog(null), [])
  assert.deepEqual(loadCatalog(''), [])
  assert.throws(() => loadCatalog('{"version":1}'), /JSON array/)
})

test('isPublishedVersion is true for catalog or root yml', () => {
  assert.equal(isPublishedVersion('0.17.1', { catalog: [], rootLatestYml: '', rootLatestMacYml: '' }), false)
  assert.equal(
    isPublishedVersion('0.17.1', { catalog: [{ version: '0.17.1' }], rootLatestYml: '', rootLatestMacYml: '' }),
    true
  )
  assert.equal(
    isPublishedVersion('0.17.2', { catalog: [], rootLatestYml: 'version: 0.17.2\n', rootLatestMacYml: '' }),
    true
  )
})

test('upsertReleasesJson missing catalog is empty then current; mark_stable waits until superseded', () => {
  const files = {
    mac: { url: 'https://releases.okvevo.com/Nia-0.17.15-mac-arm64.dmg', sha512: 'a', size: 1 },
    win: { url: 'https://releases.okvevo.com/Nia-0.17.15-win-x64.exe', sha512: 'b', size: 2 }
  }
  const first = upsertReleasesJson(null, {
    version: '0.17.15',
    date: '2026-09-21T00:00:00.000Z',
    files,
    markStable: true
  })
  assert.equal(first.length, 1)
  assert.equal(first[0].status, 'current')
  assert.equal(first[0].markedStable, true)

  const second = upsertReleasesJson(first, {
    version: '0.17.16',
    date: '2026-09-22T00:00:00.000Z',
    files: {
      mac: { url: 'https://releases.okvevo.com/Nia-0.17.16-mac-arm64.dmg', sha512: 'c', size: 3 },
      win: { url: 'https://releases.okvevo.com/Nia-0.17.16-win-x64.exe', sha512: 'd', size: 4 }
    },
    markStable: false
  })
  const byVer = Object.fromEntries(second.map(e => [e.version, e]))
  assert.equal(byVer['0.17.16'].status, 'current')
  assert.equal(byVer['0.17.15'].status, 'stable')
})

test('upsertReleasesJson keeps current + stable + last N=10', () => {
  let catalog = []
  for (let i = 1; i <= 12; i++) {
    catalog = upsertReleasesJson(catalog, {
      version: `0.17.${i}`,
      date: `2026-09-${String(i).padStart(2, '0')}T00:00:00.000Z`,
      files: { mac: { url: 'm', sha512: 'a', size: 1 }, win: { url: 'w', sha512: 'b', size: 2 } },
      markStable: i === 1
    })
  }
  const versions = catalog.map(e => e.version)
  assert.equal(catalog.find(e => e.version === '0.17.12').status, 'current')
  assert.equal(catalog.find(e => e.version === '0.17.1').status, 'stable')
  assert.ok(!versions.includes('0.17.2'))
  assert.ok(catalog.length <= CATALOG_KEEP_N + 1)
  assert.equal(retainCatalog(catalog).find(e => e.status === 'current').version, '0.17.12')
})

test('publishPointers order is stable names, then releases.json, then latest*.yml with no-store', () => {
  const version = '0.17.15'
  const dir = writePlatformDir(version, 'both')
  const store = {}
  const aws = createMemoryAws(store)
  archiveFeed({ feedDir: dir, bucket: 'releases', platform: 'mac', version, aws })
  archiveFeed({ feedDir: dir, bucket: 'releases', platform: 'win', version, aws })

  const dests = []
  const recordingAws = args => {
    const dest = destArg(args)
    if (dest) dests.push(dest)
    return aws(args)
  }
  const result = publishPointers({
    bucket: 'releases',
    version,
    markStable: true,
    date: '2026-09-21T00:00:00.000Z',
    aws: recordingAws,
    hashObject: key => ({ sha512: createHash('sha512').update(key).digest('base64'), size: 1 })
  })
  assert.equal(result.version, version)
  const stableMacAt = dests.indexOf(STABLE_MAC_NAME)
  const stableWinAt = dests.indexOf(STABLE_WIN_NAME)
  const jsonAt = dests.indexOf(RELEASES_JSON_KEY)
  const latestMacAt = dests.indexOf('latest-mac.yml')
  const latestWinAt = dests.indexOf('latest.yml')
  assert.ok(stableMacAt >= 0 && stableWinAt >= 0)
  assert.ok(Math.max(stableMacAt, stableWinAt) < jsonAt)
  assert.ok(jsonAt < latestMacAt)
  assert.ok(jsonAt < latestWinAt)

  const jsonCallIdx = dests.lastIndexOf(RELEASES_JSON_KEY)
  // cache-control is on the matching cp args, not dests-only
  const callsWithDest = dests.map((d, i) => d)
  assert.ok(store[STABLE_MAC_NAME])
  const catalog = JSON.parse(store[RELEASES_JSON_KEY].toString())
  assert.equal(catalog[0].status, 'current')
  assert.equal(catalog[0].markedStable, true)
  fs.rmSync(dir, { recursive: true, force: true })
  void callsWithDest
  void jsonCallIdx
})

test('publishPointers no-store on pointers and stable names; rollback republishes an older archived version', () => {
  const older = '0.17.10'
  const newer = '0.17.15'
  const dirOld = writePlatformDir(older, 'both')
  const dirNew = writePlatformDir(newer, 'both')
  const store = {}
  const aws = createMemoryAws(store)
  archiveFeed({ feedDir: dirOld, bucket: 'releases', platform: 'mac', version: older, aws })
  archiveFeed({ feedDir: dirOld, bucket: 'releases', platform: 'win', version: older, aws })
  const hashObject = () => ({ sha512: 'x', size: 1 })
  publishPointers({ bucket: 'releases', version: older, aws, hashObject, date: '2026-09-01T00:00:00.000Z' })

  archiveFeed({ feedDir: dirNew, bucket: 'releases', platform: 'mac', version: newer, aws })
  archiveFeed({ feedDir: dirNew, bucket: 'releases', platform: 'win', version: newer, aws })
  publishPointers({ bucket: 'releases', version: newer, aws, hashObject, date: '2026-09-21T00:00:00.000Z' })
  assert.match(store['latest.yml'].toString(), /version: 0\.17\.15/)

  const calls = []
  const recording = args => {
    calls.push(args)
    return aws(args)
  }
  publishPointers({ bucket: 'releases', version: older, aws: recording, hashObject, date: '2026-09-01T00:00:00.000Z' })
  assert.match(store['latest.yml'].toString(), /version: 0\.17\.10/)
  const catalog = JSON.parse(store[RELEASES_JSON_KEY].toString())
  assert.equal(catalog.find(e => e.status === 'current').version, older)
  assert.ok(calls.filter(a => destArg(a) === STABLE_MAC_NAME).every(a => cacheControlOf(a) === CACHE_CONTROL_NO_STORE))
  assert.ok(calls.filter(a => destArg(a) === STABLE_WIN_NAME).every(a => cacheControlOf(a) === CACHE_CONTROL_NO_STORE))
  assert.ok(calls.filter(a => destArg(a) === RELEASES_JSON_KEY).every(a => cacheControlOf(a) === CACHE_CONTROL_NO_STORE))
  assert.ok(calls.filter(a => destArg(a) === 'latest.yml').every(a => cacheControlOf(a) === CACHE_CONTROL_NO_STORE))
  assert.ok(calls.filter(a => destArg(a) === 'latest-mac.yml').every(a => cacheControlOf(a) === CACHE_CONTROL_NO_STORE))
  fs.rmSync(dirOld, { recursive: true, force: true })
  fs.rmSync(dirNew, { recursive: true, force: true })
})

test('verifyArchivedVersion checks sha512 and requires sibling blockmaps', () => {
  const version = '0.17.15'
  const dir = writePlatformDir(version, 'both')
  const store = {}
  const aws = createMemoryAws(store)
  archiveFeed({ feedDir: dir, bucket: 'releases', platform: 'mac', version, aws })
  archiveFeed({ feedDir: dir, bucket: 'releases', platform: 'win', version, aws })
  const ok = verifyArchivedVersion({ bucket: 'releases', version, aws })
  assert.equal(ok.version, version)

  delete store[`Nia-${version}-mac-arm64.zip.blockmap`]
  assert.throws(() => verifyArchivedVersion({ bucket: 'releases', version, aws }), /missing blockmap/)
  fs.rmSync(dir, { recursive: true, force: true })
})
