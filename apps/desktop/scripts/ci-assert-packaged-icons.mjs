/**
 * After Mac/Windows pack: OkVevo brand icons shipped; Hermes nous-girl / hermes
 * mark hashes must not appear in Resources or inside app.asar.
 *
 *   node apps/desktop/scripts/ci-assert-packaged-icons.mjs \
 *     --app <OkVevo.app|win-unpacked> --platform darwin|win32
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
  brandDmgVolumeIcns,
  brandLegacyMacIcns,
  brandWinIco,
  repoRootFromDesktopScripts
} from './okvevo-brand-paths.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = repoRootFromDesktopScripts(__dirname)

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] || '' : ''
}

function fail(message) {
  console.error(`[ci-assert-packaged-icons] ${message}`)
  process.exit(1)
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function loadAsar() {
  try {
    return require('@electron/asar')
  } catch (err) {
    fail(`@electron/asar unavailable: ${err.message}`)
  }
}

const app = arg('--app')
const platform = arg('--platform')
if (!app) fail('missing --app')
if (!platform) fail('missing --platform')

const brandIcns = brandLegacyMacIcns(repoRoot)
const brandIco = brandWinIco(repoRoot)
const brandVolume = brandDmgVolumeIcns(repoRoot)
for (const p of [brandIcns, brandIco, brandVolume]) {
  if (!fs.existsSync(p)) fail(`missing brand asset ${p}`)
}
const brandIcnsHash = sha256(brandIcns)
const brandIcoHash = sha256(brandIco)
const brandVolumeHash = sha256(brandVolume)

// Upstream Hermes UI marks (not overlay targets). Do not hash apps/desktop/assets
// icon.* here — before-build overlay rewrites those to brand during pack.
const bannedSources = [
  path.join(repoRoot, 'apps/desktop/public/nous-girl.png'),
  path.join(repoRoot, 'apps/desktop/public/nous-girl-dark.png')
]
const bannedHashes = new Set()
for (const src of bannedSources) {
  if (fs.existsSync(src)) bannedHashes.add(sha256(src))
}

let resources
let asarPath
if (platform === 'darwin') {
  resources = path.join(app, 'Contents', 'Resources')
  asarPath = path.join(resources, 'app.asar')
  const icns = path.join(resources, 'icon.icns')
  if (!fs.existsSync(icns)) fail(`missing packaged ${icns}`)
  const got = sha256(icns)
  if (got !== brandIcnsHash) {
    fail(`Resources/icon.icns hash ${got} != brand ${brandIcnsHash}`)
  }
} else if (platform === 'win32') {
  resources = path.join(app, 'resources')
  asarPath = path.join(resources, 'app.asar')
  const ico = path.join(resources, 'icon.ico')
  if (!fs.existsSync(ico)) fail(`missing packaged ${ico}`)
  const got = sha256(ico)
  if (got !== brandIcoHash) {
    fail(`resources/icon.ico hash ${got} != brand ${brandIcoHash}`)
  }
} else {
  fail(`unsupported --platform ${platform}`)
}

if (!fs.existsSync(asarPath)) fail(`missing ${asarPath}`)

const stampPath = path.join(resources, 'install-stamp.json')
if (fs.existsSync(stampPath)) {
  const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
  const placeholders = new Set(['', '0.0.0', 'v0.0.0', 'unknown', null])
  if (placeholders.has(stamp.displayVersion)) {
    fail(`install-stamp.displayVersion is placeholder ${JSON.stringify(stamp.displayVersion)}; set HERMES_PAYLOAD_VERSION before npm run build`)
  }
}

const asar = loadAsar()
const listed = asar.listPackage(asarPath)
// Normalize Windows asar separators so nous-girl under public\ is still caught.
const hermesNameRe = /(^|[/\\])(nous-girl[^/\\]*|hermes[^/\\]*)\.(png|gif|svg|ico|icns)$/i
const offenders = []
for (const entry of listed) {
  const rel = String(entry).replace(/^\//, '').replace(/\\/g, '/')
  if (!hermesNameRe.test(rel) && !hermesNameRe.test(String(entry))) continue
  let buf
  try {
    buf = asar.extractFile(asarPath, entry)
  } catch {
    try {
      buf = asar.extractFile(asarPath, rel)
    } catch {
      continue
    }
  }
  const hash = createHash('sha256').update(buf).digest('hex')
  if (bannedHashes.has(hash) || /nous-girl/i.test(rel)) {
    offenders.push(`${rel} sha256=${hash}`)
  }
}
if (offenders.length) {
  fail(`Hermes brand marks found inside app.asar:\n  ${offenders.join('\n  ')}`)
}

// Bootstrap installer volume icon is the brand master (same bytes as desktop .icns).
if (brandVolumeHash !== brandIcnsHash) {
  fail(`brand dmg-volume.icns hash ${brandVolumeHash} != brand icon.icns ${brandIcnsHash}`)
}
console.log(
  JSON.stringify(
    {
      ok: true,
      platform,
      brandIcnsHash,
      brandIcoHash,
      brandVolumeHash,
      asarEntriesScanned: listed.length,
      hermesMarksInAsar: 0
    },
    null,
    2
  )
)
