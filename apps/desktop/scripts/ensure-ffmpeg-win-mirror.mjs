#!/usr/bin/env node
/**
 * Ensure the Windows LGPL ffmpeg zip is on R2 (deps/ffmpeg/), SHA-256 matches
 * the BTBN pin, then optionally wipe the local vendor tree so fetch-ffmpeg.mjs
 * must cold-download from the mirror (Actions cache = speed only).
 *
 * Env: RELEASES_S3_BUCKET, RELEASES_S3_ACCESS_KEY_ID / AWS_ACCESS_KEY_ID,
 * RELEASES_S3_SECRET_ACCESS_KEY / AWS_SECRET_ACCESS_KEY, optional RELEASES_S3_ENDPOINT.
 *
 * Public readiness uses GET of the small .sha256 sidecar (not HEAD on the zip —
 * some CDN/WAF paths from GitHub-hosted Windows runners never answer 200 on HEAD).
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const PIN_SHA = '346fd19f3afe98a8606da4fc2984c8b411297734dba101cd91ec961fa8b2f875'
const ZIP_NAME = 'ffmpeg-n8.1.3-16-ge0a878dd70-win64-lgpl-8.1.zip'
const PUBLIC = `https://releases.okvevo.com/deps/ffmpeg/${ZIP_NAME}`
const PUBLIC_SHA = `${PUBLIC}.sha256`
const ROOT = path.resolve(import.meta.dirname, '..')
const VENDOR = path.join(ROOT, 'resources', 'ffmpeg')
const LOCAL_ZIP = path.join(VENDOR, '.cache', 'btbn-win64-lgpl.zip')
const cold = process.argv.includes('--cold')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function sleep(ms) {
  execFileSync(
    process.platform === 'win32' ? 'powershell' : 'sleep',
    process.platform === 'win32'
      ? ['-Command', `Start-Sleep -Milliseconds ${ms}`]
      : [String(Math.ceil(ms / 1000))],
    { stdio: 'ignore' }
  )
}

function publicSidecarSha() {
  return execFileSync('curl', ['-fsSL', '--retry', '3', PUBLIC_SHA], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0]
}

function mirrorLive() {
  try {
    return publicSidecarSha() === PIN_SHA
  } catch {
    return false
  }
}

function waitPublic(attempts = 18, delayMs = 5000) {
  for (let i = 1; i <= attempts; i++) {
    if (mirrorLive()) {
      console.log(`public sidecar ready sha256=${PIN_SHA}`)
      return
    }
    console.log(`public sidecar not ready (${i}/${attempts}); waiting ${delayMs}ms`)
    sleep(delayMs)
  }
  throw new Error(`uploaded but public sidecar still wrong after ${attempts} attempts: ${PUBLIC_SHA}`)
}

function awsCp(local, key, contentType) {
  const bucket = process.env.RELEASES_S3_BUCKET
  if (!bucket) throw new Error('RELEASES_S3_BUCKET required to seed mirror')
  const endpoint = (process.env.RELEASES_S3_ENDPOINT || '').trim()
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || process.env.RELEASES_S3_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || process.env.RELEASES_S3_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || 'auto',
    AWS_RETRY_MODE: 'standard',
    AWS_MAX_ATTEMPTS: '10'
  }
  const args = ['s3', 'cp', local, `s3://${bucket}/${key}`]
  if (endpoint) args.push('--endpoint-url', endpoint)
  if (contentType) args.push('--content-type', contentType)
  console.log(`+ aws ${args.join(' ')}`)
  execFileSync('aws', args, { stdio: 'inherit', env })
}

if (mirrorLive()) {
  console.log(`mirror already live; sidecar ok sha256=${PIN_SHA}`)
} else {
  if (!fs.existsSync(LOCAL_ZIP)) {
    throw new Error(`mirror not live and missing local zip at ${LOCAL_ZIP} (need Actions cache restore-keys)`)
  }
  const localSha = sha256(LOCAL_ZIP)
  if (localSha !== PIN_SHA) throw new Error(`local zip SHA mismatch: got ${localSha}`)
  const sidecarPath = `${LOCAL_ZIP}.sha256`
  fs.writeFileSync(sidecarPath, `${PIN_SHA}  ${ZIP_NAME}\n`)
  awsCp(LOCAL_ZIP, `deps/ffmpeg/${ZIP_NAME}`)
  awsCp(sidecarPath, `deps/ffmpeg/${ZIP_NAME}.sha256`, 'text/plain')
  waitPublic()
}

if (cold) {
  // Wipe vendor so fetch-ffmpeg.mjs cannot reuse cache; must download from R2.
  fs.rmSync(VENDOR, { recursive: true, force: true })
  console.log(`cold path: wiped ${VENDOR}`)
}
