#!/usr/bin/env node
/**
 * Build LGPL-only ffmpeg + ffprobe for macOS from pinned, SHA-256-verified
 * sources. Output: resources/ffmpeg/darwin-<arch>/{ffmpeg,ffprobe,licenses/}.
 *
 * No --enable-gpl, no libx264/libx265: H.264 encode is VideoToolbox
 * (h264_videotoolbox). libass uses CoreText for font lookup (no fontconfig)
 * and fribidi for shaping (no harfbuzz — complex-script shaping is a known
 * ceiling; CJK subtitles render via system font fallback).
 *
 * Usage: node scripts/build-ffmpeg-macos.mjs [--arch arm64|x86_64|all]
 * Prerequisites: Xcode CLT (clang, make), pkg-config, curl, python3.
 * meson/ninja are pip-installed --user at pinned versions when missing.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FFMPEG = {
  name: 'ffmpeg', version: '8.1.3',
  url: 'https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz',
  sha256: '7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3'
}
const FREETYPE = {
  name: 'freetype', version: '2.13.3',
  url: 'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz',
  sha256: '0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289'
}
const FRIBIDI = {
  name: 'fribidi', version: '1.0.16',
  url: 'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz',
  sha256: '1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c'
}
const LIBASS = {
  name: 'libass', version: '0.17.3',
  url: 'https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz',
  sha256: 'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959'
}
const LIBVPX = {
  name: 'libvpx', version: '1.15.2', ext: '.tar.gz',
  url: 'https://github.com/webmproject/libvpx/archive/refs/tags/v1.15.2.tar.gz',
  sha256: '26fcd3db88045dee380e581862a6ef106f49b74b6396ee95c2993a260b4636aa'
}
const MESON_PIP = 'meson==1.12.1'
const NINJA_PIP = 'ninja==1.13.2'
const MIN_MACOS = '12.0'

const ROOT = path.resolve(import.meta.dirname, '..')
const VENDOR = path.join(ROOT, 'resources', 'ffmpeg')
const CACHE = path.join(VENDOR, '.cache')
const WORK = path.join(VENDOR, '.build')
const LICENSES = path.join(ROOT, 'resources', 'ffmpeg-licenses')

function run(command, args, options = {}) {
  console.log(`+ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function which(tool) {
  try {
    return execFileSync('/usr/bin/which', [tool], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function download(pkg) {
  fs.mkdirSync(CACHE, { recursive: true })
  const dest = path.join(CACHE, `${pkg.name}-${pkg.version}${pkg.ext || '.tar.xz'}`)
  if (fs.existsSync(dest) && sha256(dest) === pkg.sha256) {
    console.log(`cached ${path.basename(dest)}`)
    return dest
  }
  run('curl', ['-fL', '--retry', '3', '-o', dest, pkg.url])
  const actual = sha256(dest)
  if (actual !== pkg.sha256) {
    fs.rmSync(dest, { force: true })
    throw new Error(`${pkg.name} checksum mismatch: got ${actual}`)
  }
  return dest
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function extract(tarball, dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  // bsdtar auto-detects gzip/xz from content.
  run('tar', ['-xf', tarball, '-C', dir, '--strip-components', '1'])
}

function ensureMeson(env) {
  if (which('meson') && which('ninja')) return
  // venv: PEP 668 rejects pip --user on Homebrew python (local + CI runners).
  const venv = path.join(WORK, 'venv')
  if (!fs.existsSync(path.join(venv, 'bin', 'meson'))) {
    run('python3', ['-m', 'venv', venv])
    run(path.join(venv, 'bin', 'pip'), ['install', '--quiet', MESON_PIP, NINJA_PIP])
  }
  env.PATH = `${path.join(venv, 'bin')}:${env.PATH}`
  if (!fs.existsSync(path.join(venv, 'bin', 'ninja'))) throw new Error('meson install failed')
}

/** autotools dep with a fixed prefix; cross via --host and -arch flags. */
function autotools({ dir, prefix, arch, configureArgs = [], env = process.env }) {
  const host = arch === 'x86_64' ? 'x86_64-apple-darwin' : 'arm64-apple-darwin'
  const flags = `-arch ${arch} -mmacosx-version-min=${MIN_MACOS} -O2`
  const buildEnv = { ...env, CFLAGS: flags, CXXFLAGS: flags, LDFLAGS: `-arch ${arch}` }
  run('./configure', [
    `--prefix=${prefix}`, '--disable-shared', '--enable-static', `--host=${host}`,
    ...configureArgs
  ], { cwd: dir, env: buildEnv })
  run('make', ['-j', String(os.cpus().length)], { cwd: dir, env: buildEnv })
  run('make', ['install'], { cwd: dir, env: buildEnv })
}

function mesonCrossFile(arch) {
  const file = path.join(WORK, `cross-${arch}.ini`)
  fs.writeFileSync(file, [
    '[binaries]',
    `c = ['clang', '-arch', '${arch}', '-mmacosx-version-min=${MIN_MACOS}']`,
    `cpp = ['clang++', '-arch', '${arch}', '-mmacosx-version-min=${MIN_MACOS}']`,
    '',
    '[host_machine]',
    "system = 'darwin'",
    `cpu_family = '${arch === 'x86_64' ? 'x86_64' : 'aarch64'}'`,
    `cpu = '${arch}'`,
    "endian = 'little'",
    ''
  ].join('\n'))
  return file
}

function buildFribidi({ tarball, prefix, arch, env }) {
  const dir = path.join(WORK, `fribidi-${arch}`)
  extract(tarball, dir)
  run('meson', [
    'setup', 'build', `--prefix=${prefix}`, '--default-library=static',
    '--buildtype=release', '-Ddocs=false', '-Dbin=false', '-Dtests=false',
    `--cross-file=${mesonCrossFile(arch)}`
  ], { cwd: dir, env })
  run('ninja', ['-C', 'build'], { cwd: dir, env })
  run('ninja', ['-C', 'build', 'install'], { cwd: dir, env })
}

function buildLibvpx({ tarball, prefix, arch }) {
  const dir = path.join(WORK, `libvpx-${arch}`)
  extract(tarball, dir)
  // darwin2x = macOS SDK; plain arm64-darwin-gcc targets iphoneos in libvpx.
  const target = arch === 'x86_64' ? 'x86_64-darwin23-gcc' : 'arm64-darwin23-gcc'
  const flags = `-arch ${arch} -mmacosx-version-min=${MIN_MACOS} -O2`
  run('./configure', [
    `--prefix=${prefix}`, `--target=${target}`,
    '--enable-static', '--disable-shared',
    '--disable-examples', '--disable-tools', '--disable-docs', '--disable-unit-tests',
    '--disable-vp8-encoder', '--disable-vp9-encoder'
  ], {
    cwd: dir,
    env: { ...process.env, CFLAGS: flags, CXXFLAGS: flags, LDFLAGS: `-arch ${arch}` }
  })
  run('make', ['-j', String(os.cpus().length)], { cwd: dir })
  run('make', ['install'], { cwd: dir })
}

function ffmpegConfigure(arch, depsPrefix) {
  const pkgConfig = `${depsPrefix}/lib/pkgconfig`
  const flags = `-arch ${arch} -mmacosx-version-min=${MIN_MACOS}`
  return [
    '--disable-gpl', '--disable-version3', '--disable-doc', '--disable-debug',
    '--disable-network', '--disable-devices',
    '--disable-programs', '--enable-ffmpeg', '--enable-ffprobe',
    '--disable-everything',
    // After --disable-everything (it re-disables indevs): edit_tool.py needs -f lavfi for silent spans.
    '--enable-avdevice', '--enable-indev=lavfi',
    '--enable-videotoolbox', '--enable-audiotoolbox',
    '--enable-libfreetype', '--enable-libfribidi', '--enable-libass', '--enable-libvpx',
    '--enable-demuxer=mov,matroska,webm,image2,image2pipe,concat,wav,mp3,aac,ass,srt',
    '--enable-muxer=mp4,mov,image2,image2pipe,wav,null,hash,md5',
    // wrapped_avframe: required to ENCODE from lavfi sources (testsrc2, anullsrc in edit_tool.py).
    '--enable-decoder=h264,hevc,vp8,vp9,prores,mjpeg,png,mpeg4,aac,mp3,flac,pcm_s16le,pcm_s24le,pcm_f32le,pcm_u8,ass,subrip,mov_text,webvtt,libvpx_vp8,libvpx_vp9,wrapped_avframe',
    '--enable-encoder=h264_videotoolbox,aac,png,mjpeg,pcm_s16le',
    '--enable-filter=scale,crop,fps,format,overlay,ass,subtitles,noise,loudnorm,ebur128,amix,amerge,aresample,atrim,trim,concat,setsar,setpts,pad,color,anullsrc,null,anull,volume,asetpts,settb,testsrc2,testsrc,sine,split,asplit,copy,acopy,fifo,afifo',
    '--enable-parser=h264,hevc,vp8,vp9,aac,mjpeg,png,mpegaudio',
    '--enable-bsf=aac_adtstoasc,h264_mp4toannexb,extract_extradata',
    '--enable-protocol=file,pipe',
    `--extra-cflags=${flags}`, `--extra-ldflags=-arch ${arch}`,
    '--enable-cross-compile', `--arch=${arch === 'x86_64' ? 'x86_64' : 'aarch64'}`, '--target-os=darwin',
    '--cc=clang', `--pkg-config-flags=--static`, `--prefix=${depsPrefix}`
  ]
}

function verify(outDir, arch) {
  const ffmpeg = path.join(outDir, 'ffmpeg')
  const buildconf = execFileSync(ffmpeg, ['-hide_banner', '-buildconf'], { encoding: 'utf8' })
  for (const banned of ['--enable-gpl', '--enable-nonfree', '--enable-libx264', '--enable-libx265']) {
    if (buildconf.includes(banned)) throw new Error(`GPL/nonfree component leaked into build: ${banned}`)
  }
  const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  if (!/^ V\S* h264_videotoolbox /m.test(encoders)) throw new Error('h264_videotoolbox missing')
  if (/^ V\S* (libx264|libx265) /m.test(encoders)) throw new Error('GPL encoder present in -encoders')
  const filters = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' })
  for (const required of [' ass ', ' subtitles ', ' loudnorm ', ' anullsrc ']) {
    if (!filters.includes(required)) throw new Error(`filter missing: ${required.trim()}`)
  }
  const archOut = execFileSync('/usr/bin/file', [ffmpeg], { encoding: 'utf8' })
  if (!archOut.includes(arch === 'x86_64' ? 'x86_64' : 'arm64')) throw new Error(`wrong arch: ${archOut}`)
  // Runtime smoke mirrors edit_tool.py: lavfi source -> hardware H.264 encode, and silent audio.
  if (arch === (os.arch() === 'arm64' ? 'arm64' : 'x86_64')) {
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-t', '0.05', '-i', 'anullsrc=r=48000:cl=stereo', '-f', 'null', '-'])
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-t', '0.1', '-i', 'testsrc2=size=64x64', '-c:v', 'h264_videotoolbox', '-b:v', '1M', '-f', 'null', '-'])
  }
  console.log(`verified darwin-${arch}: LGPL-only, VideoToolbox, libass, lavfi`)
}

function installLicenses(outDir) {
  const dest = path.join(outDir, 'licenses')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(LICENSES, dest, { recursive: true })
}

function buildArch(arch, tarballs) {
  const depsPrefix = path.join(WORK, `deps-${arch}`)
  const outDir = path.join(VENDOR, `darwin-${arch}`)
  const env = { ...process.env, PKG_CONFIG_PATH: `${depsPrefix}/lib/pkgconfig` }
  ensureMeson(env)

  const freetypeDir = path.join(WORK, `freetype-${arch}`)
  extract(tarballs.freetype, freetypeDir)
  autotools({
    dir: freetypeDir, prefix: depsPrefix, arch,
    configureArgs: ['--with-harfbuzz=no', '--with-brotli=no', '--with-bzip2=no', '--with-png=no']
  })
  buildFribidi({ tarball: tarballs.fribidi, prefix: depsPrefix, arch, env })
  buildLibvpx({ tarball: tarballs.libvpx, prefix: depsPrefix, arch })
  const libassDir = path.join(WORK, `libass-${arch}`)
  extract(tarballs.libass, libassDir)
  autotools({
    dir: libassDir, prefix: depsPrefix, arch, env,
    configureArgs: ['--disable-fontconfig', '--disable-asm']
  })

  const ffmpegDir = path.join(WORK, `ffmpeg-${arch}`)
  extract(tarballs.ffmpeg, ffmpegDir)
  run('./configure', ffmpegConfigure(arch, depsPrefix), { cwd: ffmpegDir, env })
  run('make', ['-j', String(os.cpus().length)], { cwd: ffmpegDir, env })

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  for (const tool of ['ffmpeg', 'ffprobe']) {
    fs.copyFileSync(path.join(ffmpegDir, tool), path.join(outDir, tool))
    fs.chmodSync(path.join(outDir, tool), 0o755)
  }
  installLicenses(outDir)
  verify(outDir, arch)
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const size = (fs.statSync(path.join(outDir, tool)).size / 1024 / 1024).toFixed(1)
    console.log(`darwin-${arch}/${tool}: ${size} MB`)
  }
}

const archArg = process.argv.find((arg, i) => process.argv[i - 1] === '--arch')
const hostArch = os.arch() === 'arm64' ? 'arm64' : 'x86_64'
const arches = archArg === 'all' ? ['arm64', 'x86_64'] : [archArg || hostArch]
if (arches.some(a => !['arm64', 'x86_64'].includes(a))) {
  throw new Error(`unsupported --arch ${archArg}`)
}
const tarballs = {
  ffmpeg: download(FFMPEG),
  freetype: download(FREETYPE),
  fribidi: download(FRIBIDI),
  libass: download(LIBASS),
  libvpx: download(LIBVPX)
}
for (const arch of arches) buildArch(arch, tarballs)
console.log('LGPL ffmpeg build complete:', arches.map(a => `resources/ffmpeg/darwin-${a}`).join(', '))
