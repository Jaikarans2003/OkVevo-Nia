/**
 * Pack-time OkVevo env for packaged OkVevo (Dock / Start Menu has no shell).
 *
 * Writes apps/desktop/build/okvevo-pack-env.json. Electron loads it after
 * dotenv and a non-empty pack value always overwrites process.env (home
 * ~/.hermes/.env / shell / whitespace). Empty pack values skip (fail closed).
 *
 * `--require` (CI): fail closed if origin or feed URL are missing or not
 * well-formed — same posture as require-release-secrets.mjs.
 * Error text names the keys only. It does not print secret values.
 *
 * Local `npm run build` without --require writes whatever is present so
 * extraResources always has a file.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'

import { isMain } from './utils.mjs'

const DESKTOP_ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(DESKTOP_ROOT, 'build')
export const PACK_ENV_FILE = join(OUT_DIR, 'okvevo-pack-env.json')

export const REQUIRED_PACK_SECRETS = ['OKVEVO_WEB_ORIGIN', 'OKVEVO_UPDATE_FEED_URL']

export const PACK_ENV_RUNTIME_KEYS = ['OKVEVO_WEB_ORIGIN', 'OKVEVO_UPDATE_FEED_URL', 'OKVEVO_UPDATE_CHANNEL']

export function missingPackSecrets(env = process.env) {
  return REQUIRED_PACK_SECRETS.filter(name => !String(env[name] ?? '').trim())
}

export function formatMissingPackSecrets(missing) {
  return [
    'Packaged OkVevo builds are fail-closed: missing portal origin or update feed.',
    `Unset: ${missing.join(', ')}`,
    'Set STAGING_OKVEVO_WEB_ORIGIN or PROD_OKVEVO_WEB_ORIGIN. The update feed URL comes from okvevo-feed-urls.mjs.'
  ].join('\n')
}

function parseHttpsUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.search || url.hash) {
      return null
    }
    return url
  } catch {
    return null
  }
}

/** Absolute https origin: no path, query, hash, or userinfo. */
export function isAbsoluteHttpsOrigin(value) {
  const url = parseHttpsUrl(value)
  return Boolean(url && (url.pathname === '/' || url.pathname === ''))
}

/** Absolute https URL. A path is allowed (the staging feed is /okvevo/staging). */
export function isAbsoluteHttpsUrl(value) {
  return parseHttpsUrl(value) !== null
}

export function invalidPackSecretShapes(env = process.env) {
  const invalid = []
  const originRaw = String(env.OKVEVO_WEB_ORIGIN ?? '').trim()
  if (originRaw && !isAbsoluteHttpsOrigin(stripSlash(originRaw))) {
    invalid.push('OKVEVO_WEB_ORIGIN')
  }
  const feedRaw = String(env.OKVEVO_UPDATE_FEED_URL ?? '').trim()
  if (feedRaw && !isAbsoluteHttpsUrl(stripSlash(feedRaw))) {
    invalid.push('OKVEVO_UPDATE_FEED_URL')
  }
  return invalid
}

export function formatInvalidPackSecrets(invalid) {
  return [
    'Packaged OkVevo builds are fail-closed: portal origin or update feed is not well-formed.',
    `Invalid: ${invalid.join(', ')}`,
    'OKVEVO_WEB_ORIGIN must be an absolute https URL with no path, query, or hash.',
    'OKVEVO_UPDATE_FEED_URL must be an absolute https URL. A path is allowed.'
  ].join('\n')
}

function stripSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

export function buildPackEnvPayload(env = process.env) {
  const channel = String(env.OKVEVO_UPDATE_CHANNEL ?? '').trim() || 'latest'
  return {
    OKVEVO_WEB_ORIGIN: stripSlash(env.OKVEVO_WEB_ORIGIN),
    OKVEVO_UPDATE_FEED_URL: stripSlash(env.OKVEVO_UPDATE_FEED_URL),
    OKVEVO_UPDATE_CHANNEL: channel
  }
}

export function writePackEnvFile(payload = buildPackEnvPayload(), outFile = PACK_ENV_FILE) {
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return outFile
}

const runAsMain = isMain(import.meta.url)

if (runAsMain) {
  const requireAll = process.argv.includes('--require')
  if (requireAll) {
    const missing = missingPackSecrets()
    if (missing.length) {
      console.error(formatMissingPackSecrets(missing))
      process.exit(1)
    }
    const invalid = invalidPackSecretShapes()
    if (invalid.length) {
      console.error(formatInvalidPackSecrets(invalid))
      process.exit(1)
    }
  }
  const payload = buildPackEnvPayload()
  const out = writePackEnvFile(payload)
  console.log(
    `[write-okvevo-pack-env] wrote ${relative(resolve(DESKTOP_ROOT, '../..'), out)}` +
      (payload.OKVEVO_WEB_ORIGIN ? ` origin=${payload.OKVEVO_WEB_ORIGIN}` : ' (origin unset)')
  )
}
