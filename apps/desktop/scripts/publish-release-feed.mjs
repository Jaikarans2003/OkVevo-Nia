/**
 * Publish OkVevo artifacts to the generic electron-updater feed (S3/R2).
 *
 * Staging sync: prefix `okvevo/staging`, installers and stable DMG/EXE names
 *   first, an HTTPS sha512/size check, then latest*.yml last.
 * Production archive: versioned OkVevo-* + blockmaps at bucket root and
 *   versions/{ver}/latest*.yml. Root live pointers stay untouched.
 *   With --prefix okvevo/stable, the same objects plus latest*.yml and the
 *   stable installer names are also written under that prefix.
 * Production publish: stable names → releases.json → root latest*.yml last,
 *   and the same live files under --prefix (bucket-root copies stay).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Agent, fetch as undiciFetch } from 'undici'

/** Multi-GB installer GETs; undici's default bodyTimeout aborts mid-stream ("terminated"). */
const longBodyAgent = new Agent({
  connectTimeout: 60_000,
  headersTimeout: 600_000,
  bodyTimeout: 0
})

const { darwinFeed } = createRequire(import.meta.url)('../update-feed.cjs')

/** Hermes Mac updater path — keep upload and smoke on the same helper. */
export function macStableFeed() {
  return darwinFeed('stable')
}

export function macStableYmlRelPath() {
  const feed = macStableFeed()
  return `${feed.directory}/${feed.fileName}`
}

/** Rewrite relative installer urls/path to absolute origin-root URLs. */
export function withAbsoluteInstallerUrls(ymlText, origin) {
  const base = String(origin || '').replace(/\/+$/, '')
  if (!base) throw new Error('withAbsoluteInstallerUrls requires origin')
  return String(ymlText || '')
    .replace(/^(\s*-\s*url:\s+)(?!https?:\/\/)(\S+)/gm, (_, prefix, name) => `${prefix}${base}/${name.replace(/^\/+/, '')}`)
    .replace(/^(path:\s+)(?!https?:\/\/)(\S+)/m, (_, prefix, name) => `${prefix}${base}/${name.replace(/^\/+/, '')}`)
}

export const STABLE_MAC_NAME = 'OkVevo-mac-arm64.dmg'
export const STABLE_WIN_NAME = 'OkVevo-win-x64.exe'
export const RELEASES_JSON_KEY = 'releases.json'
export const CATALOG_KEEP_N = 10
export const PUBLIC_FEED_ORIGIN = 'https://releases.okvevo.com'
export const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable'
export const CACHE_CONTROL_NO_STORE = 'no-store'

export function feedKey(prefix, key) {
  const cleanPrefix = String(prefix || '').replace(/^\/+|\/+$/g, '')
  const cleanKey = String(key || '').replace(/^\/+/, '')
  return cleanPrefix ? `${cleanPrefix}/${cleanKey}` : cleanKey
}

export function publicFeedOrigin(env = process.env) {
  const fromEnv = String(env.RELEASES_PUBLIC_ORIGIN || '').trim()
  return (fromEnv || PUBLIC_FEED_ORIGIN).replace(/\/+$/, '')
}

export function sha512Base64(buf) {
  return createHash('sha512').update(buf).digest('base64')
}

export function parseElectronBuilderYml(text) {
  const src = String(text || '')
  const version = (src.match(/^version:\s*(\S+)/m) || [])[1] || ''
  const pathField = (src.match(/^path:\s*(\S+)/m) || [])[1] || ''
  const topSha = (src.match(/^sha512:\s*(\S+)/m) || [])[1] || ''
  const files = []
  let inFiles = false
  let current = null
  for (const line of src.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true
      continue
    }
    if (inFiles && line && !/^\s/.test(line)) {
      inFiles = false
      if (current) {
        files.push(current)
        current = null
      }
    }
    if (!inFiles) continue
    const url = line.match(/^\s*-\s*url:\s*(\S+)/)
    if (url) {
      if (current) files.push(current)
      current = { url: url[1] }
      continue
    }
    const sha = line.match(/^\s+sha512:\s*(\S+)/)
    if (sha && current) {
      current.sha512 = sha[1]
      continue
    }
    const size = line.match(/^\s+size:\s*(\d+)/)
    if (size && current) current.size = Number(size[1])
  }
  if (current) files.push(current)
  const urls = files.length
    ? files.map(f => f.url)
    : [...src.matchAll(/^\s*-\s*url:\s*(\S+)/gm)].map(m => m[1])
  return { version, path: pathField, sha512: topSha, files, urls }
}

export function artifactNameFor(version, kind) {
  if (kind === 'mac-dmg') return `OkVevo-${version}-mac-arm64.dmg`
  if (kind === 'mac-zip') return `OkVevo-${version}-mac-arm64.zip`
  if (kind === 'win-nsis') return `OkVevo-${version}-win-x64.exe`
  throw new Error(`unknown artifact kind ${kind}`)
}

/** electron-builder --publish never does not write latest*.yml. Build them from packed files. */
export function writeUpdaterYml({ dir, platform, version, now = new Date() }) {
  const kinds = platform === 'mac' ? ['mac-zip', 'mac-dmg'] : platform === 'win' ? ['win-nsis'] : null
  if (!kinds) throw new Error(`writeUpdaterYml platform must be mac or win, got ${platform}`)
  const files = kinds.map(kind => {
    const url = artifactNameFor(version, kind)
    const buf = fs.readFileSync(path.join(dir, url))
    return { url, sha512: sha512Base64(buf), size: buf.length }
  })
  const primary = files[0]
  const body = [
    `version: ${version}`,
    'files:',
    ...files.flatMap(file => [`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: ${now.toISOString()}`
  ].join('\n') + '\n'
  const name = platform === 'mac' ? 'latest-mac.yml' : 'latest.yml'
  fs.writeFileSync(path.join(dir, name), body)
  return name
}

export function siblingBlockmapName(fileUrl) {
  const name = String(fileUrl || '')
  if (!name || name.endsWith('.blockmap')) return ''
  if (!/\.(zip|exe|dmg|7z|nupkg)$/i.test(name)) return ''
  return `${name}.blockmap`
}

export function awsArgs(env = process.env) {
  const extra = []
  const endpoint = String(env.RELEASES_S3_ENDPOINT || '').trim()
  if (endpoint) extra.push('--endpoint-url', endpoint)
  return extra
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// ponytail: a retried `s3 cp` re-sends the whole file (~1.5 GB). Per-part retries
// come from AWS_MAX_ATTEMPTS; upgrade to resumable s3api multipart if R2 timeouts get frequent.
export function withRetries(fn, { attempts = 4, delayMs = 15000, sleep = sleepSync, retryable = () => true } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn()
    } catch (err) {
      if (attempt >= attempts || !retryable(err)) throw err
      console.warn(`retry ${attempt}/${attempts - 1}: ${err instanceof Error ? err.message : err}`)
      sleep(delayMs * attempt)
    }
  }
}

function runAwsOnce(args, env) {
  const result = spawnSync('aws', [...awsArgs(env), ...args], {
    encoding: 'utf8',
    env: {
      ...env,
      AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID || env.RELEASES_S3_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY || env.RELEASES_S3_SECRET_ACCESS_KEY,
      AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION || 'auto',
      AWS_RETRY_MODE: env.AWS_RETRY_MODE || 'standard',
      AWS_MAX_ATTEMPTS: env.AWS_MAX_ATTEMPTS || '10'
    }
  })
  if (result.status !== 0) {
    throw new Error(`aws ${args.join(' ')} failed: ${result.stderr || result.stdout || result.status}`)
  }
  return result.stdout
}

function runAws(args, env = process.env) {
  return withRetries(() => runAwsOnce(args, env), { retryable: err => !isMissingObjectError(err) })
}

export function s3Uri(bucket, key) {
  const b = String(bucket || '').replace(/^s3:\/\//, '').replace(/\/+$/, '')
  const k = String(key || '').replace(/^\/+/, '')
  return `s3://${b}/${k}`
}

export function isMissingObjectError(err) {
  const msg = String(err && err.message ? err.message : err)
  return /NoSuchKey|Not Found|404|does not exist|NotFound/i.test(msg)
}

export function getTextObject({ bucket, key, aws, env }) {
  try {
    return aws(['s3', 'cp', s3Uri(bucket, key), '-'], env)
  } catch (err) {
    if (isMissingObjectError(err)) return null
    throw err
  }
}

/** Existence only — do not download. Blockmaps are gzip binaries; `s3 cp … -`
 *  with utf8 encoding blows past Node's default maxBuffer and fails Publish. */
export function objectExists({ bucket, key, aws, env }) {
  const b = String(bucket || '').replace(/^s3:\/\//, '').replace(/\/+$/, '')
  try {
    aws(['s3api', 'head-object', '--bucket', b, '--key', String(key || '').replace(/^\/+/, '')], env)
    return true
  } catch (err) {
    if (isMissingObjectError(err)) return false
    throw err
  }
}

export function loadCatalog(raw) {
  if (raw == null || String(raw).trim() === '') return []
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error(`${RELEASES_JSON_KEY} must be a JSON array`)
  }
  return parsed
}

export function isPublishedVersion(version, { catalog, rootLatestYml, rootLatestMacYml }) {
  const v = String(version)
  const entries = Array.isArray(catalog) ? catalog : []
  if (entries.some(e => String(e.version) === v)) return true
  const ymlVersions = [
    parseElectronBuilderYml(rootLatestYml || '').version,
    parseElectronBuilderYml(rootLatestMacYml || '').version
  ]
  return ymlVersions.includes(v)
}

export function compareSemver(a, b) {
  const pa = String(a).split('.').map(n => Number(n) || 0)
  const pb = String(b).split('.').map(n => Number(n) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

export function retainCatalog(entries, n = CATALOG_KEEP_N) {
  const list = Array.isArray(entries) ? entries.slice() : []
  const current = list.filter(e => e.status === 'current').map(e => e.version)
  const stable = list.filter(e => e.status === 'stable').map(e => e.version)
  const sorted = list.slice().sort((a, b) => {
    const byVer = compareSemver(b.version, a.version)
    if (byVer) return byVer
    return String(b.date || '').localeCompare(String(a.date || ''))
  })
  const keep = new Set([...current, ...stable, ...sorted.slice(0, n).map(e => e.version)])
  return list.filter(e => keep.has(e.version)).sort((a, b) => compareSemver(b.version, a.version))
}

export function upsertReleasesJson(catalog, { version, date, files, markStable = false }) {
  const entries = Array.isArray(catalog) ? catalog.map(e => ({ ...e, files: e.files ? { ...e.files } : e.files })) : []
  const previousCurrent = entries.find(e => e.status === 'current' && e.version !== version)
  if (previousCurrent) {
    const previousBecomesStable = Boolean(previousCurrent.markedStable)
    for (const e of entries) {
      if (e.version === previousCurrent.version) {
        e.status = previousBecomesStable ? 'stable' : 'available'
      } else if (previousBecomesStable && e.status === 'stable' && e.version !== version) {
        e.status = 'available'
      }
    }
  }

  const existingIdx = entries.findIndex(e => e.version === version)
  const existing = existingIdx >= 0 ? entries[existingIdx] : null
  const next = {
    version,
    date: existing?.date || date,
    files,
    status: 'current'
  }
  if (markStable || existing?.markedStable) next.markedStable = true

  if (existingIdx >= 0) entries[existingIdx] = { ...existing, ...next, files, status: 'current' }
  else entries.push(next)

  for (const e of entries) {
    if (e.version !== version && e.status === 'current') {
      e.status = e.markedStable ? 'stable' : 'available'
    }
  }

  return retainCatalog(entries)
}

export function archiveFileSet(version, platform) {
  if (platform === 'mac') {
    return {
      yml: 'latest-mac.yml',
      required: [
        artifactNameFor(version, 'mac-dmg'),
        artifactNameFor(version, 'mac-zip'),
        `${artifactNameFor(version, 'mac-zip')}.blockmap`
      ],
      globPrefix: `OkVevo-${version}-mac-`
    }
  }
  if (platform === 'win') {
    return {
      yml: 'latest.yml',
      required: [
        artifactNameFor(version, 'win-nsis'),
        `${artifactNameFor(version, 'win-nsis')}.blockmap`
      ],
      globPrefix: `OkVevo-${version}-win-`
    }
  }
  throw new Error(`platform must be mac or win, got ${JSON.stringify(platform)}`)
}

function loadPublishedState({ bucket, aws, env }) {
  const catalog = loadCatalog(getTextObject({ bucket, key: RELEASES_JSON_KEY, aws, env }))
  const rootLatestYml = getTextObject({ bucket, key: 'latest.yml', aws, env })
  const rootLatestMacYml = getTextObject({ bucket, key: 'latest-mac.yml', aws, env })
  return { catalog, rootLatestYml, rootLatestMacYml }
}

function assertNotPublished(version, state) {
  if (isPublishedVersion(version, state)) {
    throw new Error(
      `refusing to overwrite published version ${version} (in ${RELEASES_JSON_KEY} or root latest*.yml); tag a higher patch`
    )
  }
}

function cpLocalToS3({ aws, env, src, bucket, key, extra = [] }) {
  aws(['s3', 'cp', src, s3Uri(bucket, key), ...extra], env)
}

function listedArtifactNames(parsed) {
  const names = new Set()
  const add = url => {
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) names.add(url)
  }
  for (const file of parsed.files || []) add(file && file.url)
  add(parsed.path)
  for (const url of parsed.urls || []) add(url)
  return [...names]
}

export function archiveFeed({
  feedDir,
  bucket,
  platform,
  version,
  prefix = '',
  env = process.env,
  aws = runAws
}) {
  const set = archiveFileSet(version, platform)
  const ymlPath = path.join(feedDir, set.yml)
  if (!fs.existsSync(ymlPath)) {
    throw new Error(`Missing ${set.yml} in ${feedDir}`)
  }
  const ymlText = fs.readFileSync(ymlPath, 'utf8')
  const parsed = parseElectronBuilderYml(ymlText)
  if (parsed.version && parsed.version !== version) {
    throw new Error(`${set.yml} version ${parsed.version} != archive version ${version}`)
  }

  const names = fs.readdirSync(feedDir)
  const extras = names.filter(n => n.startsWith(set.globPrefix))
  const toUpload = [...new Set([...set.required, ...extras])]
  for (const name of set.required) {
    if (!fs.existsSync(path.join(feedDir, name))) {
      throw new Error(`Missing ${name} in ${feedDir}`)
    }
  }

  assertNotPublished(version, loadPublishedState({ bucket, aws, env }))

  for (const name of toUpload) {
    const src = path.join(feedDir, name)
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
    cpLocalToS3({
      aws,
      env,
      src,
      bucket,
      key: name,
      extra: ['--cache-control', CACHE_CONTROL_IMMUTABLE]
    })
  }
  cpLocalToS3({
    aws,
    env,
    src: ymlPath,
    bucket,
    key: `versions/${version}/${set.yml}`,
    extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
  })

  if (!prefix) return
  for (const name of toUpload) {
    const src = path.join(feedDir, name)
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
    cpLocalToS3({
      aws,
      env,
      src,
      bucket,
      key: feedKey(prefix, name),
      extra: ['--cache-control', CACHE_CONTROL_IMMUTABLE]
    })
  }
  cpLocalToS3({
    aws,
    env,
    src: ymlPath,
    bucket,
    key: feedKey(prefix, `versions/${version}/${set.yml}`),
    extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
  })
  const stableName = platform === 'mac' ? STABLE_MAC_NAME : STABLE_WIN_NAME
  const stableSrcName = platform === 'mac' ? artifactNameFor(version, 'mac-dmg') : artifactNameFor(version, 'win-nsis')
  cpLocalToS3({
    aws,
    env,
    src: path.join(feedDir, stableSrcName),
    bucket,
    key: feedKey(prefix, stableName),
    extra: ['--cache-control', CACHE_CONTROL_NO_STORE]
  })
  cpLocalToS3({
    aws,
    env,
    src: ymlPath,
    bucket,
    key: feedKey(prefix, set.yml),
    extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
  })
}

export function fileDigest(buf) {
  return { sha512: sha512Base64(buf), size: buf.length }
}

/** `digestOf(name)` returns `{ sha512, size }` for an uploaded object, or null when it is missing. */
export function assertYmlArtifacts(ymlText, digestOf, { requireBlockmaps = true } = {}) {
  const parsed = parseElectronBuilderYml(ymlText)
  if (!parsed.version) throw new Error('yml missing version')
  const listed = parsed.files.map(f => ({ ...f }))
  if (parsed.path && !listed.some(f => f.url === parsed.path)) {
    listed.push({ url: parsed.path, sha512: parsed.sha512 || undefined })
  }
  if (!listed.length) {
    for (const url of parsed.urls) listed.push({ url })
  }
  if (!listed.length) throw new Error('yml has no files')
  for (const file of listed) {
    if (!path.posix.basename(file.url).includes(`-${parsed.version}-`)) {
      throw new Error(`version mismatch: yml ${parsed.version} lists ${file.url}`)
    }
    const actual = digestOf(file.url)
    if (actual == null) throw new Error(`missing ${file.url}`)
    if (file.sha512 && actual.sha512 !== file.sha512) throw new Error(`sha512 mismatch for ${file.url}`)
    if (file.size != null && actual.size !== file.size) {
      throw new Error(`size mismatch for ${file.url}: yml ${file.size}, uploaded ${actual.size}`)
    }
    const blockmap = siblingBlockmapName(file.url)
    if (requireBlockmaps && blockmap && digestOf(blockmap) == null) {
      throw new Error(`missing blockmap ${blockmap}`)
    }
  }
  return parsed
}

export function feedFileUrl(origin, fileUrl) {
  const name = String(fileUrl || '')
  if (/^https?:\/\//i.test(name)) return name
  return `${String(origin).replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`
}

/** Streams the body so 1.5 GB installers never sit in memory. Null unless HTTP 200. */
export async function fetchDigest(url, fetchImpl = globalThis.fetch, { attempts = 3 } = {}) {
  const useLongBody = fetchImpl === globalThis.fetch
  const get = (u) =>
    useLongBody
      ? undiciFetch(u, { method: 'GET', dispatcher: longBodyAgent })
      : fetchImpl(u, { method: 'GET' })
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await get(url)
      if (!res || res.status !== 200) return null
      const hash = createHash('sha512')
      let size = 0
      for await (const chunk of res.body) {
        hash.update(chunk)
        size += chunk.length
      }
      return { sha512: hash.digest('base64'), size }
    } catch (err) {
      lastErr = err
      console.error(`fetchDigest ${i}/${attempts} ${url}: ${err instanceof Error ? err.message : err}`)
    }
  }
  throw lastErr
}

/** Every file a yml lists must answer HTTP 200 at `origin` with the yml's sha512 and size. */
export async function verifyYmlsOverHttp({ origin, ymlTexts, fetchImpl = globalThis.fetch, requireBlockmaps = true }) {
  const digests = new Map()
  const names = new Set()
  for (const text of ymlTexts) {
    const parsed = parseElectronBuilderYml(text)
    for (const name of [...parsed.urls, ...parsed.files.map(f => f.url), parsed.path].filter(Boolean)) {
      names.add(name)
      if (requireBlockmaps && siblingBlockmapName(name)) names.add(siblingBlockmapName(name))
    }
  }
  for (const name of names) digests.set(name, await fetchDigest(feedFileUrl(origin, name), fetchImpl))
  return ymlTexts.map(text => assertYmlArtifacts(text, name => digests.get(name) ?? null, { requireBlockmaps }))
}

function objectToBuffer({ bucket, key, aws, env, tmpDir }) {
  const dest = path.join(tmpDir, key.replace(/[/\\]/g, '_'))
  aws(['s3', 'cp', s3Uri(bucket, key), dest], env)
  return fs.readFileSync(dest)
}

function tryObjectToBuffer(opts) {
  try {
    return objectToBuffer(opts)
  } catch (err) {
    if (isMissingObjectError(err)) return null
    throw err
  }
}

/** Hash a local file in chunks — avoid buffering multi-GB installers. */
export function hashFileSync(filePath) {
  const hash = createHash('sha512')
  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.alloc(8 * 1024 * 1024)
  let size = 0
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      hash.update(n === buf.length ? buf : buf.subarray(0, n))
      size += n
    }
  } finally {
    fs.closeSync(fd)
  }
  return { sha512: hash.digest('base64'), size }
}

function tryObjectDigest({ bucket, key, aws, env, tmpDir }) {
  const dest = path.join(tmpDir, key.replace(/[/\\]/g, '_'))
  try {
    aws(['s3', 'cp', s3Uri(bucket, key), dest], env)
  } catch (err) {
    if (isMissingObjectError(err)) return null
    throw err
  }
  try {
    return hashFileSync(dest)
  } finally {
    try {
      fs.unlinkSync(dest)
    } catch {
      /* ignore */
    }
  }
}

export function verifyArchivedVersion({
  bucket,
  version,
  env = process.env,
  aws = runAws,
  tmpDir
}) {
  const ownedTmp = tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nia-verify-'))
  try {
    const readFile = name => tryObjectDigest({ bucket, key: name, aws, env, tmpDir: ownedTmp })
    const parsed = []
    for (const name of ['latest.yml', 'latest-mac.yml']) {
      const key = `versions/${version}/${name}`
      const yml = getTextObject({ bucket, key, aws, env })
      if (yml == null) throw new Error(`missing ${key}`)
      const one = assertYmlArtifacts(yml, readFile)
      if (one.version !== version) {
        throw new Error(`${key} version ${one.version} != ${version}`)
      }
      parsed.push(one)
    }
    if (parsed[0].version !== parsed[1].version) {
      throw new Error(`mac version ${parsed[1].version} != win version ${parsed[0].version}`)
    }
    return { version, win: parsed[0], mac: parsed[1] }
  } finally {
    if (!tmpDir) fs.rmSync(ownedTmp, { recursive: true, force: true })
  }
}

function copyS3({ aws, env, bucket, fromKey, toKey, extra = [] }) {
  // R2 CopyObject implements metadata-directive, Content-Type, and Cache-Control.
  // It rejects x-amz-tagging-directive. `aws s3 cp --copy-props` (including `none`)
  // sets that header to REPLACE; an explicit metadata directive skips those subscribers.
  aws(
    [
      's3',
      'cp',
      s3Uri(bucket, fromKey),
      s3Uri(bucket, toKey),
      '--metadata-directive',
      'REPLACE',
      ...extra
    ],
    env
  )
}

export function publishPointers({
  bucket,
  version,
  markStable = false,
  date = new Date().toISOString(),
  origin,
  prefix = '',
  env = process.env,
  aws = runAws,
  hashObject,
  tmpDir
}) {
  const feedOrigin = origin || publicFeedOrigin(env)
  const ownedTmp = tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nia-publish-'))
  try {
    const macYml = getTextObject({
      bucket,
      key: `versions/${version}/latest-mac.yml`,
      aws,
      env
    })
    const winYml = getTextObject({
      bucket,
      key: `versions/${version}/latest.yml`,
      aws,
      env
    })
    if (macYml == null || winYml == null) {
      throw new Error(`missing versions/${version}/latest*.yml`)
    }
    const mac = parseElectronBuilderYml(macYml)
    const win = parseElectronBuilderYml(winYml)
    if (!mac.version || !win.version) throw new Error('archived yml missing version')
    if (mac.version !== version || win.version !== version) {
      throw new Error(`archived yml version ${mac.version}/${win.version} != ${version}`)
    }

    const macDmg = artifactNameFor(version, 'mac-dmg')
    const winExe = artifactNameFor(version, 'win-nsis')
    const hash =
      hashObject ||
      (key => {
        const buf = objectToBuffer({ bucket, key, aws, env, tmpDir: ownedTmp })
        return { sha512: sha512Base64(buf), size: buf.length }
      })
    const macMeta = hash(macDmg)
    const winMeta = hash(winExe)
    const files = {
      mac: {
        url: `${feedOrigin}/${macDmg}`,
        sha512: macMeta.sha512,
        size: macMeta.size
      },
      win: {
        url: `${feedOrigin}/${winExe}`,
        sha512: winMeta.sha512,
        size: winMeta.size
      }
    }

    const catalog = loadCatalog(getTextObject({ bucket, key: RELEASES_JSON_KEY, aws, env }))
    const next = upsertReleasesJson(catalog, { version, date, files, markStable })

    copyS3({
      aws,
      env,
      bucket,
      fromKey: macDmg,
      toKey: STABLE_MAC_NAME,
      extra: ['--cache-control', CACHE_CONTROL_NO_STORE]
    })
    copyS3({
      aws,
      env,
      bucket,
      fromKey: winExe,
      toKey: STABLE_WIN_NAME,
      extra: ['--cache-control', CACHE_CONTROL_NO_STORE]
    })

    const jsonPath = path.join(ownedTmp, RELEASES_JSON_KEY)
    fs.writeFileSync(jsonPath, `${JSON.stringify(next, null, 2)}\n`)
    cpLocalToS3({
      aws,
      env,
      src: jsonPath,
      bucket,
      key: RELEASES_JSON_KEY,
      extra: ['--content-type', 'application/json', '--cache-control', CACHE_CONTROL_NO_STORE]
    })

    copyS3({
      aws,
      env,
      bucket,
      fromKey: `versions/${version}/latest-mac.yml`,
      toKey: 'latest-mac.yml',
      extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
    })
    copyS3({
      aws,
      env,
      bucket,
      fromKey: `versions/${version}/latest.yml`,
      toKey: 'latest.yml',
      extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
    })

    if (prefix) {
      const names = new Set([...listedArtifactNames(mac), ...listedArtifactNames(win), macDmg, winExe])
      for (const name of names) {
        copyS3({
          aws,
          env,
          bucket,
          fromKey: name,
          toKey: feedKey(prefix, name),
          extra: ['--cache-control', CACHE_CONTROL_IMMUTABLE]
        })
        const blockmap = siblingBlockmapName(name)
        if (blockmap && objectExists({ bucket, key: blockmap, aws, env })) {
          copyS3({
            aws,
            env,
            bucket,
            fromKey: blockmap,
            toKey: feedKey(prefix, blockmap),
            extra: ['--cache-control', CACHE_CONTROL_IMMUTABLE]
          })
        }
      }
      copyS3({
        aws,
        env,
        bucket,
        fromKey: macDmg,
        toKey: feedKey(prefix, STABLE_MAC_NAME),
        extra: ['--cache-control', CACHE_CONTROL_NO_STORE]
      })
      copyS3({
        aws,
        env,
        bucket,
        fromKey: winExe,
        toKey: feedKey(prefix, STABLE_WIN_NAME),
        extra: ['--cache-control', CACHE_CONTROL_NO_STORE]
      })
      const prefixOrigin = `${publicFeedOrigin(env)}/${String(prefix).replace(/\/+$/, '')}`
      const macAbs = withAbsoluteInstallerUrls(macYml, prefixOrigin)
      const macStableLocal = path.join(ownedTmp, 'stable-mac.yml')
      fs.writeFileSync(macStableLocal, macAbs)
      cpLocalToS3({
        aws,
        env,
        src: macStableLocal,
        bucket,
        key: feedKey(prefix, macStableYmlRelPath()),
        extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
      })
      copyS3({
        aws,
        env,
        bucket,
        fromKey: `versions/${version}/latest-mac.yml`,
        toKey: feedKey(prefix, 'latest-mac.yml'),
        extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
      })
      copyS3({
        aws,
        env,
        bucket,
        fromKey: `versions/${version}/latest.yml`,
        toKey: feedKey(prefix, 'latest.yml'),
        extra: ['--content-type', 'text/yaml', '--cache-control', CACHE_CONTROL_NO_STORE]
      })
    }

    return {
      version,
      stableMac: STABLE_MAC_NAME,
      stableWin: STABLE_WIN_NAME,
      catalog: next
    }
  } finally {
    if (!tmpDir) fs.rmSync(ownedTmp, { recursive: true, force: true })
  }
}

/**
 * Installers first, then prove them over public HTTP against the local yml,
 * then latest*.yml last, so a failed upload never leaves the feed pointing at a
 * missing or partial file.
 */
export async function syncFeed({
  feedDir,
  bucket,
  prefix = '',
  mode,
  env = process.env,
  aws = runAws,
  fetchImpl = globalThis.fetch
}) {
  if (mode !== 'staging') {
    throw new Error(`syncFeed mode must be staging, got ${mode}`)
  }

  const ymlNames = ['latest-mac.yml', 'latest.yml']
  const [macYml, winYml] = ymlNames.map(name => fs.readFileSync(path.join(feedDir, name), 'utf8'))
  const mac = parseElectronBuilderYml(macYml)
  const win = parseElectronBuilderYml(winYml)
  if (!mac.version || !win.version) {
    throw new Error('staging latest yml missing version')
  }
  if (mac.version !== win.version) {
    throw new Error(`staging mac version ${mac.version} != win version ${win.version}`)
  }
  const macDmg = artifactNameFor(mac.version, 'mac-dmg')
  const winExe = artifactNameFor(win.version, 'win-nsis')
  for (const name of [macDmg, winExe]) {
    if (!fs.existsSync(path.join(feedDir, name))) {
      throw new Error(`Missing ${name} in ${feedDir}`)
    }
  }

  const destPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : ''
  aws(['s3', 'sync', feedDir, s3Uri(bucket, destPrefix), '--exclude', '*', '--include', 'OkVevo-*'], env)
  // Local→S3 (not S3→S3): R2 rejects GetObjectTagging on server-side copy.
  for (const [srcName, destName] of [
    [macDmg, STABLE_MAC_NAME],
    [winExe, STABLE_WIN_NAME]
  ]) {
    aws(
      ['s3', 'cp', path.join(feedDir, srcName), s3Uri(bucket, `${destPrefix}${destName}`), '--cache-control', 'public,max-age=300'],
      env
    )
  }

  const feedOrigin = `${publicFeedOrigin(env)}/${destPrefix}`.replace(/\/+$/, '')
  const macYmlAbsolute = withAbsoluteInstallerUrls(macYml, feedOrigin)
  // Staging artifacts carry no blockmaps; the updater falls back to a full download.
  await verifyYmlsOverHttp({
    origin: feedOrigin,
    ymlTexts: [macYml, winYml],
    fetchImpl,
    requireBlockmaps: false
  })

  const macStableRel = macStableYmlRelPath()
  const macStableLocal = path.join(feedDir, path.basename(macStableRel))
  fs.writeFileSync(macStableLocal, macYmlAbsolute)

  // Installers already verified — ymls last (Hermes Mac path + dual-write latest*).
  for (const [localPath, destName] of [
    [macStableLocal, macStableRel],
    [path.join(feedDir, 'latest-mac.yml'), 'latest-mac.yml'],
    [path.join(feedDir, 'latest.yml'), 'latest.yml']
  ]) {
    aws(
      [
        's3',
        'cp',
        localPath,
        s3Uri(bucket, `${destPrefix}${destName}`),
        '--content-type',
        'text/yaml',
        '--cache-control',
        CACHE_CONTROL_NO_STORE
      ],
      env
    )
  }

  // Prove the Mac app-request URL itself (absolute installer urls already in body).
  await verifyYmlsOverHttp({
    origin: feedOrigin,
    ymlTexts: [macYmlAbsolute],
    fetchImpl,
    requireBlockmaps: false
  })
}

function flag(name, argv) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : ''
}

const isMain = process.argv[1] && process.argv[1].endsWith('publish-release-feed.mjs')

if (isMain) {
  const cmd = process.argv[2]
  if (cmd === 'write-yml') {
    const name = writeUpdaterYml({
      dir: flag('--dir', process.argv) || '.',
      platform: flag('--platform', process.argv),
      version: flag('--version', process.argv)
    })
    console.log(name)
    process.exit(0)
  }
  const bucket = process.env.RELEASES_S3_BUCKET
  if (!bucket) {
    console.error('RELEASES_S3_BUCKET is required')
    process.exit(1)
  }
  if (cmd === 'sync') {
    await syncFeed({
      feedDir: flag('--dir', process.argv) || 'feed',
      bucket,
      prefix: flag('--prefix', process.argv) || '',
      mode: flag('--mode', process.argv)
    })
  } else if (cmd === 'archive') {
    archiveFeed({
      feedDir: flag('--dir', process.argv) || 'feed',
      bucket,
      platform: flag('--platform', process.argv),
      version: flag('--version', process.argv),
      prefix: flag('--prefix', process.argv) || ''
    })
  } else if (cmd === 'verify') {
    const result = verifyArchivedVersion({
      bucket,
      version: flag('--version', process.argv)
    })
    console.log(JSON.stringify({ version: result.version }))
  } else if (cmd === 'publish') {
    const result = publishPointers({
      bucket,
      version: flag('--version', process.argv),
      markStable: process.argv.includes('--mark-stable'),
      prefix: flag('--prefix', process.argv) || ''
    })
    console.log(JSON.stringify({ version: result.version, stableMac: result.stableMac, stableWin: result.stableWin }))
  } else {
    console.error('Usage: publish-release-feed.mjs write-yml --dir DIR --platform mac|win --version X.Y.Z')
    console.error('       publish-release-feed.mjs sync --dir DIR --mode staging [--prefix okvevo/staging]')
    console.error('       publish-release-feed.mjs archive --dir DIR --platform mac|win --version X.Y.Z [--prefix okvevo/stable]')
    console.error('       publish-release-feed.mjs verify --version X.Y.Z')
    console.error('       publish-release-feed.mjs publish --version X.Y.Z [--mark-stable] [--prefix okvevo/stable]')
    process.exit(1)
  }
}
