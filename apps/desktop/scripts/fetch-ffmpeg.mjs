#!/usr/bin/env node
/**
 * Ensure resources/ffmpeg/<platform>-<arch>/ ships LGPL ffmpeg + ffprobe.
 *
 * - darwin: reuse an existing build; else OKVEVO_FFMPEG_MIRROR (a mirror of this
 *   repo's own build output, <mirror>/darwin-<arch>.tar.gz + .sha256 sidecar);
 *   else build from source via build-ffmpeg-macos.mjs.
 * - win32: OKVEVO_FFMPEG_MIRROR (or the OkVevo R2 default under deps/ffmpeg/)
 *   serves the pinned BtbN win64-lgpl zip + .sha256 sidecar. BTBN.url stays the
 *   upstream pin record — do not rewrite it to R2. SHA-256 is fail-closed;
 *   Actions cache is speed only.
 *
 * When the target binaries can execute on this host, the script verifies the
 * build configuration (--enable-gpl / --enable-nonfree / libx264 / libx265
 * absent, hardware encoder present). Cross-fetches only verify the checksum;
 * the native CI runner re-runs this script and performs the runtime asserts.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const BTBN = {
  url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-09-14-16/ffmpeg-n8.1.3-16-ge0a878dd70-win64-lgpl-8.1.zip',
  sha256: '346fd19f3afe98a8606da4fc2984c8b411297734dba101cd91ec961fa8b2f875',
  zipName: 'ffmpeg-n8.1.3-16-ge0a878dd70-win64-lgpl-8.1.zip'
}

/** OkVevo-owned Windows primary (pack env may override via OKVEVO_FFMPEG_MIRROR). */
const OKVEVO_WIN_FFMPEG_MIRROR = 'https://releases.okvevo.com/deps/ffmpeg'

const ROOT = path.resolve(import.meta.dirname, '..')
const VENDOR = path.join(ROOT, 'resources', 'ffmpeg')
const CACHE = path.join(VENDOR, '.cache')
const LICENSES = path.join(ROOT, 'resources', 'ffmpeg-licenses')

function run(command, args, options = {}) {
  console.log(`+ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function binaries(platform, arch) {
  const dir = path.join(VENDOR, `${platform}-${arch}`)
  const exe = platform === 'win32' ? '.exe' : ''
  return { dir, ffmpeg: path.join(dir, `ffmpeg${exe}`), ffprobe: path.join(dir, `ffprobe${exe}`) }
}

function installLicenses(dir) {
  fs.cpSync(LICENSES, path.join(dir, 'licenses'), { recursive: true })
}

function verifyNative(ffmpeg, platform) {
  const buildconf = execFileSync(ffmpeg, ['-hide_banner', '-buildconf'], { encoding: 'utf8' })
  for (const banned of ['--enable-gpl', '--enable-nonfree', '--enable-libx264', '--enable-libx265']) {
    if (buildconf.includes(banned)) throw new Error(`GPL/nonfree component in ffmpeg build: ${banned}`)
  }
  const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  if (/^ V\S* (libx264|libx265) /m.test(encoders)) throw new Error('GPL encoder present in -encoders')
  const hardware = platform === 'win32' ? 'h264_mf' : 'h264_videotoolbox'
  if (!new RegExp(`^ V\\S* ${hardware} `, 'm').test(encoders)) {
    throw new Error(`hardware H.264 encoder missing: ${hardware}`)
  }
  console.log(`verified ${ffmpeg}: LGPL-only, ${hardware} present`)
}

function windowsMirrorBase() {
  const fromEnv = (process.env.OKVEVO_FFMPEG_MIRROR || '').trim().replace(/\/+$/, '')
  return fromEnv || OKVEVO_WIN_FFMPEG_MIRROR
}

function readSidecarSha(sidecarPath) {
  if (!fs.existsSync(sidecarPath)) return null
  const expected = fs.readFileSync(sidecarPath, 'utf8').trim().split(/\s+/)[0]
  return /^[a-f0-9]{64}$/i.test(expected) ? expected.toLowerCase() : null
}

function fetchWindows(arch) {
  if (arch !== 'x64') throw new Error(`no LGPL Windows build pinned for ${arch}`)
  fs.mkdirSync(CACHE, { recursive: true })
  const zip = path.join(CACHE, 'btbn-win64-lgpl.zip')
  const sidecar = `${zip}.sha256`
  const mirror = windowsMirrorBase()
  const url = `${mirror}/${BTBN.zipName}`
  // Pin is BTBN.sha256; sidecar (when present) must agree. Network sidecar only on cold fetch.
  let expected = readSidecarSha(sidecar) || BTBN.sha256
  if (!fs.existsSync(zip) || sha256(zip) !== expected) {
    // OkVevo: primary URL is R2 via OKVEVO_FFMPEG_MIRROR / OKVEVO_WIN_FFMPEG_MIRROR — keep BTBN.url as pin only.
    run('curl', ['-fL', '--retry', '3', '-o', zip, url])
    try {
      run('curl', ['-fL', '--retry', '3', '-o', sidecar, `${mirror}/${BTBN.zipName}.sha256`])
      expected = readSidecarSha(sidecar) || BTBN.sha256
    } catch {
      expected = BTBN.sha256
    }
    const actual = sha256(zip)
    if (actual !== expected) {
      fs.rmSync(zip, { force: true })
      throw new Error(`Windows ffmpeg zip checksum mismatch: got ${actual}, want ${expected}`)
    }
  }
  const { dir, ffmpeg, ffprobe } = binaries('win32', arch)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const scratch = path.join(CACHE, 'btbn-extract')
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.mkdirSync(scratch, { recursive: true })
  // Git Bash puts GNU tar first on PATH; it cannot read .zip and parses "D:" as a host.
  const tar =
    process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  run(tar, ['-xf', zip, '-C', scratch])
  const inner = fs.readdirSync(scratch)[0]
  fs.copyFileSync(path.join(scratch, inner, 'bin', 'ffmpeg.exe'), ffmpeg)
  fs.copyFileSync(path.join(scratch, inner, 'bin', 'ffprobe.exe'), ffprobe)
  installLicenses(dir)
  fs.copyFileSync(path.join(scratch, inner, 'LICENSE.txt'), path.join(dir, 'licenses', 'BtbN-LICENSE.txt'))
  fs.rmSync(scratch, { recursive: true, force: true })
}

function fetchDarwin(arch) {
  const mirror = (process.env.OKVEVO_FFMPEG_MIRROR || '').trim().replace(/\/+$/, '')
  if (mirror) {
    fs.mkdirSync(CACHE, { recursive: true })
    const tarball = path.join(CACHE, `darwin-${arch}.tar.gz`)
    run('curl', ['-fL', '--retry', '3', '-o', tarball, `${mirror}/darwin-${arch}.tar.gz`])
    run('curl', ['-fL', '--retry', '3', '-o', `${tarball}.sha256`, `${mirror}/darwin-${arch}.tar.gz.sha256`])
    const expected = fs.readFileSync(`${tarball}.sha256`, 'utf8').trim().split(/\s+/)[0]
    if (sha256(tarball) !== expected) throw new Error(`mirror darwin-${arch} checksum mismatch`)
    const { dir } = binaries('darwin', arch)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    run('tar', ['-xzf', tarball, '-C', dir])
    installLicenses(dir)
    return
  }
  run(process.execPath, [path.join(import.meta.dirname, 'build-ffmpeg-macos.mjs'), '--arch', arch])
}

const argValue = name => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const platform = argValue('--platform') || process.platform
const arch = argValue('--arch') || process.arch
if (!['darwin', 'win32'].includes(platform)) throw new Error(`no ffmpeg bundling for ${platform}`)

const { dir, ffmpeg, ffprobe } = binaries(platform, arch)
if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) {
  console.log(`ffmpeg already bundled at ${dir}`)
} else if (platform === 'win32') {
  fetchWindows(arch)
} else {
  fetchDarwin(arch)
}

if (platform === process.platform && arch === process.arch) {
  verifyNative(ffmpeg, platform)
} else {
  console.log(`cross-fetch for ${platform}-${arch}: checksum verified; encoder asserts run on the native CI runner`)
}
for (const tool of [ffmpeg, ffprobe]) {
  console.log(`${path.basename(tool)}: ${(fs.statSync(tool).size / 1024 / 1024).toFixed(1)} MB`)
}
