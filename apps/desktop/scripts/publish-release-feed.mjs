/**
 * Publish signed Nia artifacts to the generic electron-updater feed (S3/R2).
 *
 * Staging: prefix `staging/`, keep electron-builder latest*.yml names,
 *   and copy versioned DMG/EXE → stable names under the prefix.
 * Production: bucket root, rename latest*.yml → internal*.yml (do not touch latest).
 * Promote: copy internal*.yml → latest*.yml and versioned artifacts → stable names.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const STABLE_MAC_NAME = 'Nia-mac-arm64.dmg'
export const STABLE_WIN_NAME = 'Nia-win-x64.exe'

export function parseElectronBuilderYml(text) {
  const version = (text.match(/^version:\s*(\S+)/m) || [])[1] || ''
  const pathField = (text.match(/^path:\s*(\S+)/m) || [])[1] || ''
  const urls = [...text.matchAll(/^\s*-\s*url:\s*(\S+)/gm)].map(m => m[1])
  return { version, path: pathField, urls }
}

export function artifactNameFor(version, kind) {
  if (kind === 'mac-dmg') return `Nia-${version}-mac-arm64.dmg`
  if (kind === 'mac-zip') return `Nia-${version}-mac-arm64.zip`
  if (kind === 'win-nsis') return `Nia-${version}-win-x64.exe`
  throw new Error(`unknown artifact kind ${kind}`)
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

export function renameLatestYmlToInternal(feedDir) {
  const mapping = [
    ['latest-mac.yml', 'internal-mac.yml'],
    ['latest.yml', 'internal.yml']
  ]
  const written = []
  for (const [fromName, toName] of mapping) {
    const from = path.join(feedDir, fromName)
    if (!fs.existsSync(from)) {
      throw new Error(`Missing ${fromName} in ${feedDir}`)
    }
    const to = path.join(feedDir, toName)
    fs.copyFileSync(from, to)
    written.push(to)
  }
  return written
}

export function syncFeed({
  feedDir,
  bucket,
  prefix = '',
  mode,
  env = process.env,
  aws = runAws
}) {
  const destPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : ''
  const includes = ['Nia-*']
  if (mode === 'staging') {
    includes.push('latest*.yml')
  } else if (mode === 'production-internal') {
    renameLatestYmlToInternal(feedDir)
    includes.push('internal.yml', 'internal-mac.yml')
  } else {
    throw new Error(`syncFeed mode must be staging or production-internal, got ${mode}`)
  }

  const args = [
    's3',
    'sync',
    feedDir,
    s3Uri(bucket, destPrefix),
    '--exclude',
    '*',
    ...includes.flatMap(pattern => ['--include', pattern])
  ]
  if (mode === 'production-internal') {
    args.push('--exclude', 'latest*.yml')
  }
  aws(args, env)

  // Same "latest stable artifact" pattern as promoteInternalToLatest, under prefix.
  if (mode === 'staging') {
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
        [
          's3',
          'cp',
          src,
          s3Uri(bucket, `${destPrefix}${destName}`),
          '--cache-control',
          'public,max-age=300'
        ],
        env
      )
    }
  }
}

export function promoteInternalToLatest({
  bucket,
  env = process.env,
  aws = runAws,
  readObject = key => aws(['s3', 'cp', s3Uri(bucket, key), '-'], env)
}) {
  const copies = [
    ['internal-mac.yml', 'latest-mac.yml'],
    ['internal.yml', 'latest.yml']
  ]
  const yml = {}
  for (const [from, to] of copies) {
    aws(
      [
        's3',
        'cp',
        s3Uri(bucket, from),
        s3Uri(bucket, to),
        '--copy-props',
        'none',
        '--content-type',
        'text/yaml',
        '--cache-control',
        'public,max-age=0,must-revalidate'
      ],
      env
    )
    yml[from] = readObject(from)
  }

  const mac = parseElectronBuilderYml(yml['internal-mac.yml'])
  const win = parseElectronBuilderYml(yml['internal.yml'])
  if (!mac.version || !win.version) {
    throw new Error('internal yml missing version')
  }
  if (mac.version !== win.version) {
    throw new Error(`mac version ${mac.version} != win version ${win.version}`)
  }

  const macDmg = artifactNameFor(mac.version, 'mac-dmg')
  const winExe = artifactNameFor(win.version, 'win-nsis')
  // --copy-props none: R2 does not implement GetObjectTagging on S3→S3 copy.
  aws(
    [
      's3',
      'cp',
      s3Uri(bucket, macDmg),
      s3Uri(bucket, STABLE_MAC_NAME),
      '--copy-props',
      'none',
      '--cache-control',
      'public,max-age=300'
    ],
    env
  )
  aws(
    [
      's3',
      'cp',
      s3Uri(bucket, winExe),
      s3Uri(bucket, STABLE_WIN_NAME),
      '--copy-props',
      'none',
      '--cache-control',
      'public,max-age=300'
    ],
    env
  )

  return { version: mac.version, macDmg, winExe, stableMac: STABLE_MAC_NAME, stableWin: STABLE_WIN_NAME }
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
  } else if (cmd === 'promote') {
    const result = promoteInternalToLatest({ bucket })
    console.log(JSON.stringify(result))
  } else {
    console.error('Usage: publish-release-feed.mjs sync --dir DIR --mode staging|production-internal [--prefix staging]')
    console.error('       publish-release-feed.mjs promote')
    process.exit(1)
  }
}
