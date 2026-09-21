/**
 * Publish Nia artifacts to the generic electron-updater feed (S3/R2).
 *
 * Staging: prefix `staging/`, keep electron-builder latest*.yml names,
 *   and copy versioned DMG/EXE → stable names under the prefix.
 * Production archive: versioned Nia-* + blockmaps at bucket root and
 *   versions/{ver}/latest*.yml. Never writes live pointers.
 * Production publish: stable names → releases.json → root latest*.yml last.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const STABLE_MAC_NAME = 'Nia-mac-arm64.dmg'
export const STABLE_WIN_NAME = 'Nia-win-x64.exe'
export const RELEASES_JSON_KEY = 'releases.json'
export const CATALOG_KEEP_N = 10
export const PUBLIC_FEED_ORIGIN = 'https://releases.okvevo.com'
export const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable'
export const CACHE_CONTROL_NO_STORE = 'no-store'

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
  if (kind === 'mac-dmg') return `Nia-${version}-mac-arm64.dmg`
  if (kind === 'mac-zip') return `Nia-${version}-mac-arm64.zip`
  if (kind === 'win-nsis') return `Nia-${version}-win-x64.exe`
  throw new Error(`unknown artifact kind ${kind}`)
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

function runAws(args, env = process.env) {
  const result = spawnSync('aws', [...awsArgs(env), ...args], {
    encoding: 'utf8',
    env: {
      ...env,
      AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID || env.RELEASES_S3_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY || env.RELEASES_S3_SECRET_ACCESS_KEY,
      AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION || 'auto'
    }
  })
  if (result.status !== 0) {
    throw new Error(`aws ${args.join(' ')} failed: ${result.stderr || result.stdout || result.status}`)
  }
  return result.stdout
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
      globPrefix: `Nia-${version}-mac-`
    }
  }
  if (platform === 'win') {
    return {
      yml: 'latest.yml',
      required: [
        artifactNameFor(version, 'win-nsis'),
        `${artifactNameFor(version, 'win-nsis')}.blockmap`
      ],
      globPrefix: `Nia-${version}-win-`
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

export function archiveFeed({
  feedDir,
  bucket,
  platform,
  version,
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
}

export function assertYmlArtifacts(ymlText, readFile) {
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
    const body = readFile(file.url)
    if (body == null) throw new Error(`missing ${file.url}`)
    if (file.sha512) {
      const actual = sha512Base64(body)
      if (actual !== file.sha512) throw new Error(`sha512 mismatch for ${file.url}`)
    }
    const blockmap = siblingBlockmapName(file.url)
    if (blockmap) {
      const bm = readFile(blockmap)
      if (bm == null) throw new Error(`missing blockmap ${blockmap}`)
    }
  }
  return parsed
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

export function verifyArchivedVersion({
  bucket,
  version,
  env = process.env,
  aws = runAws,
  tmpDir
}) {
  const ownedTmp = tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nia-verify-'))
  try {
    const readFile = name => tryObjectToBuffer({ bucket, key: name, aws, env, tmpDir: ownedTmp })
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
  aws(
    ['s3', 'cp', s3Uri(bucket, fromKey), s3Uri(bucket, toKey), '--copy-props', 'none', ...extra],
    env
  )
}

export function publishPointers({
  bucket,
  version,
  markStable = false,
  date = new Date().toISOString(),
  origin,
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

export function syncFeed({
  feedDir,
  bucket,
  prefix = '',
  mode,
  env = process.env,
  aws = runAws
}) {
  if (mode !== 'staging') {
    throw new Error(`syncFeed mode must be staging, got ${mode}`)
  }

  const destPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : ''
  aws(
    [
      's3',
      'sync',
      feedDir,
      s3Uri(bucket, destPrefix),
      '--exclude',
      '*',
      '--include',
      'Nia-*',
      '--include',
      'latest*.yml'
    ],
    env
  )

  const macYml = fs.readFileSync(path.join(feedDir, 'latest-mac.yml'), 'utf8')
  const winYml = fs.readFileSync(path.join(feedDir, 'latest.yml'), 'utf8')
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
  // Local→S3 (not S3→S3): R2 rejects GetObjectTagging on server-side copy.
  for (const [srcName, destName] of [
    [macDmg, STABLE_MAC_NAME],
    [winExe, STABLE_WIN_NAME]
  ]) {
    const src = path.join(feedDir, srcName)
    if (!fs.existsSync(src)) {
      throw new Error(`Missing ${srcName} in ${feedDir}`)
    }
    aws(
      ['s3', 'cp', src, s3Uri(bucket, `${destPrefix}${destName}`), '--cache-control', 'public,max-age=300'],
      env
    )
  }
}

function flag(name, argv) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : ''
}

const isMain = process.argv[1] && process.argv[1].endsWith('publish-release-feed.mjs')

if (isMain) {
  const cmd = process.argv[2]
  const bucket = process.env.RELEASES_S3_BUCKET
  if (!bucket) {
    console.error('RELEASES_S3_BUCKET is required')
    process.exit(1)
  }
  if (cmd === 'sync') {
    syncFeed({
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
      version: flag('--version', process.argv)
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
      markStable: process.argv.includes('--mark-stable')
    })
    console.log(JSON.stringify({ version: result.version, stableMac: result.stableMac, stableWin: result.stableWin }))
  } else {
    console.error('Usage: publish-release-feed.mjs sync --dir DIR --mode staging [--prefix staging]')
    console.error('       publish-release-feed.mjs archive --dir DIR --platform mac|win --version X.Y.Z')
    console.error('       publish-release-feed.mjs verify --version X.Y.Z')
    console.error('       publish-release-feed.mjs publish --version X.Y.Z [--mark-stable]')
    process.exit(1)
  }
}
