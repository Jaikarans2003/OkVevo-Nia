/**
 * Pack-time OkVevo env for packaged Nia (Dock / Start Menu has no shell).
 *
 * Writes apps/desktop/build/okvevo-pack-env.json. Electron loads it after
 * dotenv and only fills unset keys (runtime ~/.hermes/.env still wins).
 *
 * `--require` (CI): fail closed if origin, feed URL, or Vite Firebase keys
 * are missing — same posture as require-release-secrets.mjs.
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

export const REQUIRED_PACK_SECRETS = [
  'OKVEVO_WEB_ORIGIN',
  'NIA_UPDATE_FEED_URL',
  'VITE_OKVEVO_FIREBASE_API_KEY',
  'VITE_OKVEVO_FIREBASE_AUTH_DOMAIN',
  'VITE_OKVEVO_FIREBASE_PROJECT_ID',
  'VITE_OKVEVO_FIREBASE_STORAGE_BUCKET',
  'VITE_OKVEVO_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_OKVEVO_FIREBASE_APP_ID'
]

export const PACK_ENV_RUNTIME_KEYS = ['OKVEVO_WEB_ORIGIN', 'NIA_UPDATE_FEED_URL', 'NIA_UPDATE_CHANNEL']

export function missingPackSecrets(env = process.env) {
  return REQUIRED_PACK_SECRETS.filter(name => !String(env[name] ?? '').trim())
}

export function formatMissingPackSecrets(missing) {
  return [
    'Packaged Nia builds are fail-closed: missing portal origin, update feed, or Vite Firebase keys.',
    `Unset: ${missing.join(', ')}`,
    'Set STAGING_* or PROD_* repository secrets (mapped in the desktop workflow). Do not hardcode www.okvevo.com.'
  ].join('\n')
}

function stripSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

export function buildPackEnvPayload(env = process.env) {
  const channel = String(env.NIA_UPDATE_CHANNEL ?? '').trim() || 'latest'
  return {
    OKVEVO_WEB_ORIGIN: stripSlash(env.OKVEVO_WEB_ORIGIN),
    NIA_UPDATE_FEED_URL: stripSlash(env.NIA_UPDATE_FEED_URL),
    NIA_UPDATE_CHANNEL: channel
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
  }
  const payload = buildPackEnvPayload()
  const out = writePackEnvFile(payload)
  console.log(
    `[write-okvevo-pack-env] wrote ${relative(resolve(DESKTOP_ROOT, '../..'), out)}` +
      (payload.OKVEVO_WEB_ORIGIN ? ` origin=${payload.OKVEVO_WEB_ORIGIN}` : ' (origin unset)')
  )
}
