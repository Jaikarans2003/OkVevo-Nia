/**
 * Assert brand/.../dmg-layout.json matches the Hotfix 2.2 Finder contract and
 * that 1x/2x background PNGs exist at the contracted pixel sizes.
 * Also reloads electron-builder.config.cjs with a cache-bust so its `dmg`
 * fragment must match the JSON (not a stale require).
 *
 * Runnable without a built DMG (JSON + file dimensions) — Windows-safe.
 *
 *   node apps/desktop/scripts/ci-assert-dmg-layout.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import {
  brandDmgBackground,
  brandDmgBackground2x,
  brandDmgLayoutJson,
  repoRootFromDesktopScripts
} from './okvevo-brand-paths.mjs'
import { loadDmgLayout } from './okvevo-dmg-layout.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = repoRootFromDesktopScripts(__dirname)
const require = createRequire(import.meta.url)

/** Contract pinned by Hotfix 2.2 — do not drift silently. */
const CONTRACT = {
  window: { width: 660, height: 400 },
  iconSize: 96,
  iconTextSize: 11,
  backgroundColor: '#f4f2ee',
  contents: [
    { x: 180, y: 175, type: 'file' },
    { x: 480, y: 175, type: 'link', path: '/Applications' }
  ]
}

function fail(message) {
  console.error(`[ci-assert-dmg-layout] ${message}`)
  process.exit(1)
}

function pngSize(filePath) {
  const data = fs.readFileSync(filePath)
  if (data.length < 24 || data.subarray(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') {
    fail(`not a PNG: ${filePath}`)
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

const layoutPath = brandDmgLayoutJson(repoRoot)
const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
const resolved = loadDmgLayout(repoRoot)

if (JSON.stringify(layout.window) !== JSON.stringify(CONTRACT.window)) {
  fail(`layout.window ${JSON.stringify(layout.window)} != contract ${JSON.stringify(CONTRACT.window)}`)
}
if (layout.iconSize !== CONTRACT.iconSize || layout.iconTextSize !== CONTRACT.iconTextSize) {
  fail(`iconSize/textSize drift: ${layout.iconSize}/${layout.iconTextSize}`)
}
if (layout.backgroundColor !== CONTRACT.backgroundColor) {
  fail(`backgroundColor ${layout.backgroundColor} != ${CONTRACT.backgroundColor}`)
}
if (JSON.stringify(layout.contents) !== JSON.stringify(CONTRACT.contents)) {
  fail(`contents ${JSON.stringify(layout.contents)} != contract ${JSON.stringify(CONTRACT.contents)}`)
}

// Symmetry: icon x positions average to window center.
const mid = (layout.contents[0].x + layout.contents[1].x) / 2
if (mid !== layout.window.width / 2) {
  fail(`contents x not symmetric about ${layout.window.width / 2} (mid=${mid})`)
}
if (layout.contents[0].y !== layout.contents[1].y) {
  fail(`contents y not equal: ${layout.contents[0].y} vs ${layout.contents[1].y}`)
}

if (JSON.stringify(resolved.contents) !== JSON.stringify(layout.contents)) {
  fail('loadDmgLayout contents != dmg-layout.json')
}
if (resolved.window?.width !== layout.window.width || resolved.iconSize !== layout.iconSize) {
  fail('loadDmgLayout window/iconSize != dmg-layout.json')
}

const bg1 = brandDmgBackground(repoRoot)
const bg2 = brandDmgBackground2x(repoRoot)
if (!fs.existsSync(bg1)) fail(`missing ${bg1}`)
if (!fs.existsSync(bg2)) fail(`missing ${bg2}`)

const s1 = pngSize(bg1)
const s2 = pngSize(bg2)
if (s1.width !== CONTRACT.window.width || s1.height !== CONTRACT.window.height) {
  fail(`1x background ${s1.width}x${s1.height} != ${CONTRACT.window.width}x${CONTRACT.window.height}`)
}
if (s2.width !== CONTRACT.window.width * 2 || s2.height !== CONTRACT.window.height * 2) {
  fail(`2x background ${s2.width}x${s2.height} != ${CONTRACT.window.width * 2}x${CONTRACT.window.height * 2}`)
}

// Cache-bust require so we compare a fresh electron-builder dmg fragment.
const builderPath = path.join(repoRoot, 'apps/desktop/electron-builder.config.cjs')
const bust = `${builderPath}?t=${Date.now()}`
try {
  // createRequire cannot bust ESM-style; delete from cache then require.
  delete require.cache[require.resolve(builderPath)]
  const builder = require(builderPath)
  const dmg = builder?.dmg
  if (!dmg) fail('electron-builder.config.cjs has no dmg')
  if (JSON.stringify(dmg.contents) !== JSON.stringify(CONTRACT.contents)) {
    fail(`electron-builder dmg.contents ${JSON.stringify(dmg.contents)} != contract`)
  }
  if (dmg.window?.width !== CONTRACT.window.width || dmg.iconSize !== CONTRACT.iconSize) {
    fail('electron-builder dmg window/iconSize != contract')
  }
  if (path.resolve(dmg.background) !== path.resolve(bg1)) {
    fail(`electron-builder dmg.background ${dmg.background} != ${bg1}`)
  }
} catch (err) {
  fail(`could not load electron-builder.config.cjs: ${err.message}`)
}

console.log('[ci-assert-dmg-layout] ok')
void pathToFileURL
void bust
