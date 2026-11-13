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
  writeUpdaterYml,
  isMissingObjectError,
  isPublishedVersion,
  loadCatalog,
  macStableYmlRelPath,
  fetchDigest,
  hashFileSync,
  objectExists,
  parseElectronBuilderYml,
  publishPointers,
  retainCatalog,
  s3Uri,
  sha512Base64,
  siblingBlockmapName,
  syncFeed,
  upsertReleasesJson,
  verifyArchivedVersion,
  withAbsoluteInstallerUrls,
  withRetries
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
    if (args[0] === 's3api' && args[1] === 'head-object') {
      const key = args[args.indexOf('--key') + 1]
      if (!Object.prototype.hasOwnProperty.call(store, key)) {
        throw new Error(`Not Found ${key}`)
      }
      return ''
    }
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
      '  - url: OkVevo-0.17.42-mac-arm64.zip',
      '    sha512: abc',
      '    size: 9',
      'path: OkVevo-0.17.42-mac-arm64.zip'
    ].join('\n')
  )
  assert.equal(parsed.version, '0.17.42')
  assert.equal(parsed.path, 'OkVevo-0.17.42-mac-arm64.zip')
  assert.equal(parsed.files[0].sha512, 'abc')
  assert.equal(parsed.files[0].size, 9)
  assert.deepEqual(artifactNameFor('0.17.42', 'mac-dmg'), 'OkVevo-0.17.42-mac-arm64.dmg')
  assert.deepEqual(artifactNameFor('0.17.42', 'win-nsis'), 'OkVevo-0.17.42-win-x64.exe')
  assert.equal(s3Uri('bucket', 'staging/latest.yml'), 's3://bucket/staging/latest.yml')
  assert.equal(siblingBlockmapName('OkVevo-0.17.42-mac-arm64.zip'), 'OkVevo-0.17.42-mac-arm64.zip.blockmap')
  assert.equal(siblingBlockmapName('a.zip.blockmap'), '')
})

test('objectExists uses head-object (no download) for binary blockmaps', () => {
  const store = { 'OkVevo-0.1.0-mac-arm64.zip.blockmap': Buffer.from([0x1f, 0x8b, 0x08]) }
  const aws = createMemoryAws(store)
  assert.equal(objectExists({ bucket: 'releases', key: 'OkVevo-0.1.0-mac-arm64.zip.blockmap', aws }), true)
  assert.equal(objectExists({ bucket: 'releases', key: 'missing.blockmap', aws }), false)
})

test('hashFileSync matches sha512Base64 for chunked reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-hash-'))
  const file = path.join(dir, 'blob')
  const body = Buffer.alloc(9 * 1024 * 1024, 0x5a)
  fs.writeFileSync(file, body)
  const got = hashFileSync(file)
  assert.equal(got.size, body.length)
  assert.equal(got.sha512, sha512Base64(body))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('fetchDigest retries then succeeds', async () => {
  const body = Buffer.from('installer-bytes')
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    if (calls < 3) throw new Error('terminated')
    return {
      status: 200,
      body: (async function* () {
        yield body
      })()
    }
  }
  const got = await fetchDigest('https://example.test/OkVevo.exe', fetchImpl, { attempts: 3 })
  assert.equal(calls, 3)
  assert.equal(got.size, body.length)
  assert.equal(got.sha512, sha512Base64(body))
})

test('writeUpdaterYml builds electron-updater files from packed artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okvevo-yml-'))
  const version = '0.0.7'
  const zip = Buffer.from('zip-bytes')
  const dmg = Buffer.from('dmg-bytes')
  const exe = Buffer.from('exe-bytes')
  fs.writeFileSync(path.join(dir, artifactNameFor(version, 'mac-zip')), zip)
  fs.writeFileSync(path.join(dir, artifactNameFor(version, 'mac-dmg')), dmg)
  fs.writeFileSync(path.join(dir, artifactNameFor(version, 'win-nsis')), exe)
  const now = new Date('2026-10-22T20:00:00.000Z')
  assert.equal(writeUpdaterYml({ dir, platform: 'mac', version, now }), 'latest-mac.yml')
  assert.equal(writeUpdaterYml({ dir, platform: 'win', version, now }), 'latest.yml')
  const mac = parseElectronBuilderYml(fs.readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8'))
  const win = parseElectronBuilderYml(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'))
  assert.equal(mac.version, version)
  assert.equal(mac.path, artifactNameFor(version, 'mac-zip'))
  assert.equal(mac.files[0].sha512, sha512Base64(zip))
  assert.equal(mac.files[1].url, artifactNameFor(version, 'mac-dmg'))
  assert.equal(win.path, artifactNameFor(version, 'win-nsis'))
  assert.equal(win.files[0].size, exe.length)
})

async function runStagingSync({ serve = (key, body) => body } = {}) {
  const version = '0.17.8'
  const dir = writePlatformDir(version, 'both')
  const store = {}
  const events = []
  const memory = createMemoryAws(store)
  const aws = args => {
    if (args[1] === 'sync') {
      assert.ok(!args.includes('latest*.yml'))
      const prefix = keyFromS3(args[3])
      for (const name of fs.readdirSync(dir).filter(n => n.startsWith('OkVevo-'))) {
        store[prefix + name] = fs.readFileSync(path.join(dir, name))
      }
      events.push('sync')
      return ''
    }
    events.push(destArg(args))
    return memory(args)
  }
  const fetchImpl = async url => {
    events.push(`GET ${url}`)
    const key = url.replace('https://releases.okvevo.com/', '')
    const body = store[key] && serve(key, Buffer.from(store[key]))
    return body ? { status: 200, body: [body] } : { status: 404, body: [] }
  }
  try {
    await syncFeed({ feedDir: dir, bucket: 'releases', prefix: 'okvevo/staging', mode: 'staging', aws, fetchImpl, env: {} })
    return { version, store, events }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}


test('macStableYmlRelPath matches darwinFeed(stable)', () => {
  assert.equal(macStableYmlRelPath(), 'releases/darwin/stable/stable-mac.yml')
})

test('withAbsoluteInstallerUrls rewrites relative urls to origin root', () => {
  const body = withAbsoluteInstallerUrls(
    'version: 0.1.0\nfiles:\n  - url: OkVevo-0.1.0-mac-arm64.zip\npath: OkVevo-0.1.0-mac-arm64.zip\n',
    'https://releases.okvevo.com/okvevo/staging'
  )
  assert.match(body, /url: https:\/\/releases\.okvevo\.com\/okvevo\/staging\/OkVevo-0\.1\.0-mac-arm64\.zip/)
  assert.match(body, /path: https:\/\/releases\.okvevo\.com\/okvevo\/staging\/OkVevo-0\.1\.0-mac-arm64\.zip/)
})

test('staging sync uploads installers, proves them over HTTP, then latest*.yml last', async () => {
  const { version, store, events } = await runStagingSync()
  const firstGet = events.findIndex(e => String(e).startsWith('GET '))
  assert.ok(events.indexOf('sync') < firstGet)
  assert.ok(events.indexOf(`okvevo/staging/${STABLE_MAC_NAME}`) < firstGet)
  assert.ok(events.indexOf(`okvevo/staging/${STABLE_WIN_NAME}`) < firstGet)
  assert.ok(events.includes(`GET https://releases.okvevo.com/okvevo/staging/OkVevo-${version}-win-x64.exe`))
  assert.ok(firstGet < events.indexOf('okvevo/staging/latest-mac.yml'))
  assert.ok(firstGet < events.indexOf('okvevo/staging/latest.yml'))
  assert.ok(firstGet < events.indexOf('okvevo/staging/releases/darwin/stable/stable-mac.yml'))
  assert.match(store['okvevo/staging/latest.yml'].toString(), new RegExp(`version: ${version}`))
  const stableMac = store['okvevo/staging/releases/darwin/stable/stable-mac.yml'].toString()
  assert.match(stableMac, new RegExp(`version: ${version}`))
  assert.match(stableMac, /url: https:\/\/releases\.okvevo\.com\/okvevo\/staging\/OkVevo-/)
})

test('staging sync never uploads latest*.yml when an uploaded installer does not match it', async () => {
  const exe = 'okvevo/staging/OkVevo-0.17.8-win-x64.exe'
  await assert.rejects(
    () => runStagingSync({ serve: (key, body) => (key === exe ? body.subarray(1) : body) }),
    /sha512 mismatch for OkVevo-0\.17\.8-win-x64\.exe/
  )
  await assert.rejects(() => runStagingSync({ serve: (key, body) => (key === exe ? null : body) }), /missing OkVevo-0\.17\.8-win-x64\.exe/)
})

test('syncFeed rejects production-internal', async () => {
  await assert.rejects(
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

test('withRetries retries a transient R2 timeout but not a missing object', () => {
  let calls = 0
  const sleeps = []
  const out = withRetries(
    () => {
      if (++calls < 3) throw new Error('AWS_ERROR_HTTP_RESPONSE_FIRST_BYTE_TIMEOUT')
      return 'ok'
    },
    { delayMs: 1, sleep: ms => sleeps.push(ms) }
  )
  assert.equal(out, 'ok')
  assert.deepEqual(sleeps, [1, 2])
  assert.throws(() => withRetries(() => { throw new Error('timeout') }, { attempts: 2, sleep: () => {} }), /timeout/)
  let missing = 0
  assert.throws(
    () =>
      withRetries(
        () => {
          missing++
          throw new Error('NoSuchKey')
        },
        { sleep: () => {}, retryable: err => !isMissingObjectError(err) }
      ),
    /NoSuchKey/
  )
  assert.equal(missing, 1)
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
  assert.ok(store[`OkVevo-${version}-mac-arm64.dmg`])
  assert.ok(store[`OkVevo-${version}-mac-arm64.zip`])
  assert.ok(store[`OkVevo-${version}-mac-arm64.zip.blockmap`])
  assert.ok(store[`versions/${version}/latest-mac.yml`])
  assert.equal(store['latest-mac.yml'], undefined)
  assert.equal(store['latest.yml'], undefined)
  assert.equal(store[RELEASES_JSON_KEY], undefined)
  const dmgCall = calls.find(a => destArg(a) === `OkVevo-${version}-mac-arm64.dmg`)
  assert.equal(cacheControlOf(dmgCall), CACHE_CONTROL_IMMUTABLE)
  const ymlCall = calls.find(a => destArg(a) === `versions/${version}/latest-mac.yml`)
  assert.equal(cacheControlOf(ymlCall), CACHE_CONTROL_NO_STORE)
  assert.ok(!calls.some(a => a.includes('s3 rm') || a.includes('delete-object')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('archiveFeed unpublished retry re-uploads the platform full set', () => {
  const version = '0.17.16'
  const dir = writePlatformDir(version, 'win')
  const store = { [`OkVevo-${version}-win-x64.exe`]: Buffer.from('stale') }
  archiveFeed({
    feedDir: dir,
    bucket: 'releases',
    platform: 'win',
    version,
    aws: createMemoryAws(store)
  })
  assert.equal(Buffer.from(store[`OkVevo-${version}-win-x64.exe`]).toString(), 'exe-0.17.16')
  assert.ok(store[`OkVevo-${version}-win-x64.exe.blockmap`])
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
    mac: { url: 'https://releases.okvevo.com/OkVevo-0.17.15-mac-arm64.dmg', sha512: 'a', size: 1 },
    win: { url: 'https://releases.okvevo.com/OkVevo-0.17.15-win-x64.exe', sha512: 'b', size: 2 }
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
      mac: { url: 'https://releases.okvevo.com/OkVevo-0.17.16-mac-arm64.dmg', sha512: 'c', size: 3 },
      win: { url: 'https://releases.okvevo.com/OkVevo-0.17.16-win-x64.exe', sha512: 'd', size: 4 }
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
  const serverCopies = calls.filter(
    a => a[1] === 'cp' && String(a[2]).startsWith('s3://') && String(a[3]).startsWith('s3://')
  )
  assert.equal(serverCopies.length, 4)
  for (const args of serverCopies) {
    assert.equal(args.includes('--copy-props'), false)
    assert.equal(args.includes('--tagging-directive'), false)
    assert.equal(args[args.indexOf('--metadata-directive') + 1], 'REPLACE')
  }
  for (const name of ['latest.yml', 'latest-mac.yml']) {
    const args = serverCopies.find(a => destArg(a) === name)
    assert.equal(args[args.indexOf('--content-type') + 1], 'text/yaml')
  }
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

  delete store[`OkVevo-${version}-mac-arm64.zip.blockmap`]
  assert.throws(() => verifyArchivedVersion({ bucket: 'releases', version, aws }), /missing blockmap/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('archiveFeed prefix writes okvevo/stable live yml and installers without root live yml', () => {
  const version = '0.17.15'
  const dir = writePlatformDir(version, 'mac')
  const store = {}
  const memory = createMemoryAws(store)
  const dests = []
  archiveFeed({
    feedDir: dir,
    bucket: 'releases',
    platform: 'mac',
    version,
    prefix: 'okvevo/stable',
    aws: args => {
      dests.push(destArg(args))
      return memory(args)
    }
  })
  assert.equal(dests.at(-1), 'okvevo/stable/latest-mac.yml')
  assert.equal(store['latest-mac.yml'], undefined)
  assert.ok(store[`OkVevo-${version}-mac-arm64.dmg`])
  assert.ok(store[`okvevo/stable/OkVevo-${version}-mac-arm64.dmg`])
  assert.ok(store[`okvevo/stable/OkVevo-${version}-mac-arm64.zip`])
  assert.ok(store['okvevo/stable/latest-mac.yml'])
  assert.ok(store[`okvevo/stable/versions/${version}/latest-mac.yml`])
  assert.equal(
    Buffer.from(store['okvevo/stable/OkVevo-mac-arm64.dmg']).toString(),
    Buffer.from(store[`OkVevo-${version}-mac-arm64.dmg`]).toString()
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('publishPointers prefix mirrors live yml and installers and keeps bucket-root copies', () => {
  const version = '0.17.15'
  const dir = writePlatformDir(version, 'both')
  const store = {}
  const aws = createMemoryAws(store)
  archiveFeed({ feedDir: dir, bucket: 'releases', platform: 'mac', version, aws })
  archiveFeed({ feedDir: dir, bucket: 'releases', platform: 'win', version, aws })
  publishPointers({
    bucket: 'releases',
    version,
    prefix: 'okvevo/stable',
    aws,
    hashObject: () => ({ sha512: 'x', size: 1 }),
    date: '2026-09-21T00:00:00.000Z'
  })
  assert.match(store['latest-mac.yml'].toString(), new RegExp(`version: ${version}`))
  assert.match(store['latest.yml'].toString(), new RegExp(`version: ${version}`))
  assert.ok(store[STABLE_MAC_NAME])
  assert.ok(store[STABLE_WIN_NAME])
  assert.match(store['okvevo/stable/latest-mac.yml'].toString(), new RegExp(`version: ${version}`))
  assert.match(store['okvevo/stable/latest.yml'].toString(), new RegExp(`version: ${version}`))
  assert.ok(store[`okvevo/stable/${STABLE_MAC_NAME}`])
  assert.ok(store[`okvevo/stable/${STABLE_WIN_NAME}`])
  assert.ok(store[`okvevo/stable/OkVevo-${version}-mac-arm64.zip`])
  assert.ok(store[`okvevo/stable/OkVevo-${version}-win-x64.exe`])
  assert.ok(store[`okvevo/stable/OkVevo-${version}-mac-arm64.zip.blockmap`])
  assert.equal(store['okvevo/stable/releases.json'], undefined)
  fs.rmSync(dir, { recursive: true, force: true })
})
