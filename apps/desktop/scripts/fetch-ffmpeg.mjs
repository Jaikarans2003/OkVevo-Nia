#!/usr/bin/env node
/**
 * Ensure resources/ffmpeg/<platform>-<arch>/ ships LGPL ffmpeg + ffprobe.
 *
 * - darwin: reuse an existing build; else NIA_FFMPEG_MIRROR (a mirror of this
 *   repo's own build output, <mirror>/darwin-<arch>.tar.gz + .sha256 sidecar);
 *   else build from source via build-ffmpeg-macos.mjs.
 * - win32: pinned BtbN FFmpeg-Builds "win64-lgpl" static zip (SHA-256
 *   verified). Asserted free of GPL encoders; h264_mf (Media Foundation) is
 *   the hardware H.264 path.
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
  sha256: '346fd19f3afe98a8606da4fc2984c8b411297734dba101cd91ec961fa8b2f875'
}

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

function fetchWindows(arch) {
  if (arch !== 'x64') throw new Error(`no LGPL Windows build pinned for ${arch}`)
  fs.mkdirSync(CACHE, { recursive: true })
  const zip = path.join(CACHE, 'btbn-win64-lgpl.zip')
  if (!fs.existsSync(zip) || sha256(zip) !== BTBN.sha256) {
    run('curl', ['-fL', '--retry', '3', '-o', zip, BTBN.url])
    const actual = sha256(zip)
    if (actual !== BTBN.sha256) {
      fs.rmSync(zip, { force: true })
      throw new Error(`BtbN zip checksum mismatch: got ${actual}`)
    }
  }
  const { dir, ffmpeg, ffprobe } = binaries('win32', arch)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const scratch = path.join(CACHE, 'btbn-extract')
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.mkdirSync(scratch, { recursive: true })
  run('tar', ['-xf', zip, '-C', scratch])
  const inner = fs.readdirSync(scratch)[0]
  fs.copyFileSync(path.join(scratch, inner, 'bin', 'ffmpeg.exe'), ffmpeg)
  fs.copyFileSync(path.join(scratch, inner, 'bin', 'ffprobe.exe'), ffprobe)
  installLicenses(dir)
  fs.copyFileSync(path.join(scratch, inner, 'LICENSE.txt'), path.join(dir, 'licenses', 'BtbN-LICENSE.txt'))
  fs.rmSync(scratch, { recursive: true, force: true })
}

function fetchDarwin(arch) {
  const mirror = (process.env.NIA_FFMPEG_MIRROR || '').trim().replace(/\/+$/, '')
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
