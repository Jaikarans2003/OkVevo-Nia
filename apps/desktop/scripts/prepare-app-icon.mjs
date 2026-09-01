#!/usr/bin/env node
/**
 * Bake ~80% safe-area padding into the Nia app icon master, then regenerate
 * platform bundles (PNG, ICNS, ICO) used by electron-builder and the runtime.
 *
 * macOS: 1024×1024 PNG with transparent padding; iconutil builds .icns.
 * Windows: multi-size .ico from the same padded master (PNG-in-ICO, Vista+).
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const assetsDir = path.join(desktopRoot, 'assets')
const publicDir = path.join(desktopRoot, 'public')

const MASTER = 1024
const ARTWORK = 820 // ~80% of 1024 — HIG safe area for Dock/Taskbar parity

const INPUT_CANDIDATES = [
  path.join(assetsDir, 'Nia.png'),
  path.join(desktopRoot, '..', '..', '..', 'Nia.png'),
  path.join(assetsDir, 'icon.png')
]

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

function resolveInput() {
  for (const candidate of INPUT_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`No source icon found. Tried: ${INPUT_CANDIDATES.join(', ')}`)
}

/** Read PNG width/height from the IHDR chunk (bytes 16–23). */
function pngDimensions(filePath) {
  const buf = fs.readFileSync(filePath)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Pack PNG buffers into a Windows Vista+ ICO (embedded PNGs). */
function writePngIco(pngBuffers, outPath) {
  const count = pngBuffers.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = 6 + count * 16

  for (const buf of pngBuffers) {
    const { width, height } = pngDimensionsFromBuffer(buf)
    const entry = Buffer.alloc(16)
    entry.writeUInt8(width >= 256 ? 0 : width, 0)
    entry.writeUInt8(height >= 256 ? 0 : height, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(buf.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += buf.length
  }

  fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...pngBuffers]))
}

function pngDimensionsFromBuffer(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function buildPaddedMaster(inputPath, workDir) {
  const scaled = path.join(workDir, 'artwork.png')
  const master = path.join(workDir, 'master.png')

  run(`sips -z ${ARTWORK} ${ARTWORK} "${inputPath}" --out "${scaled}"`)
  run(`sips --padToHeightWidth ${MASTER} ${MASTER} "${scaled}" --out "${master}"`)

  return master
}

function buildIcns(masterPath, workDir, outPath) {
  const iconset = path.join(workDir, 'icons.iconset')
  fs.mkdirSync(iconset, { recursive: true })

  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png']
  ]

  for (const [size, name] of sizes) {
    const out = path.join(iconset, name)
    run(`sips -z ${size} ${size} "${masterPath}" --out "${out}"`)
  }

  fs.copyFileSync(masterPath, path.join(iconset, 'icon_512x512@2x.png'))
  run(`iconutil -c icns "${iconset}" -o "${outPath}"`)
}

function buildIco(masterPath, workDir, outPath) {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = []

  for (const size of icoSizes) {
    const out = path.join(workDir, `ico-${size}.png`)
    run(`sips -z ${size} ${size} "${masterPath}" --out "${out}"`)
    pngBuffers.push(fs.readFileSync(out))
  }

  writePngIco(pngBuffers, outPath)
}

function main() {
  if (process.platform !== 'darwin') {
    console.warn('[prepare-app-icon] sips/iconutil are macOS-only; skipping generation on', process.platform)
    process.exit(0)
  }

  const inputPath = resolveInput()
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-icon-'))
  const masterPath = buildPaddedMaster(inputPath, workDir)

  const { width, height } = pngDimensions(masterPath)
  if (width !== MASTER || height !== MASTER) {
    throw new Error(`Expected ${MASTER}×${MASTER} master, got ${width}×${height}`)
  }

  const iconPng = path.join(assetsDir, 'icon.png')
  const iconIcns = path.join(assetsDir, 'icon.icns')
  const iconIco = path.join(assetsDir, 'icon.ico')
  const publicPng = path.join(publicDir, 'nia.png')

  fs.copyFileSync(masterPath, iconPng)
  fs.copyFileSync(masterPath, publicPng)
  buildIcns(masterPath, workDir, iconIcns)
  buildIco(masterPath, workDir, iconIco)

  fs.rmSync(workDir, { recursive: true, force: true })

  console.log('[prepare-app-icon] wrote', iconPng)
  console.log('[prepare-app-icon] wrote', iconIcns)
  console.log('[prepare-app-icon] wrote', iconIco)
  console.log('[prepare-app-icon] wrote', publicPng)
}

main()
