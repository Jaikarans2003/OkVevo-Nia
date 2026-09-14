/**
 * Map STAGING_* / PROD_* repository secrets onto the unprefixed names
 * vite + write-okvevo-pack-env.mjs read. Writes GITHUB_ENV when present.
 *
 * GitHub only injects secrets that a workflow references, so callers still
 * list every STAGING_* / PROD_* key in `env:`. This file is the one if/else.
 */
import fs from 'node:fs'

export const TARGET_PREFIX = {
  staging: 'STAGING',
  production: 'PROD'
}

/** dest process env → secret suffix after STAGING_ / PROD_ */
export const MAPPED_KEYS = [
  ['OKVEVO_WEB_ORIGIN', 'OKVEVO_WEB_ORIGIN'],
  ['NIA_UPDATE_FEED_URL', 'UPDATE_FEED_URL'],
  ['VITE_OKVEVO_FIREBASE_API_KEY', 'VITE_OKVEVO_FIREBASE_API_KEY'],
  ['VITE_OKVEVO_FIREBASE_AUTH_DOMAIN', 'VITE_OKVEVO_FIREBASE_AUTH_DOMAIN'],
  ['VITE_OKVEVO_FIREBASE_PROJECT_ID', 'VITE_OKVEVO_FIREBASE_PROJECT_ID'],
  ['VITE_OKVEVO_FIREBASE_STORAGE_BUCKET', 'VITE_OKVEVO_FIREBASE_STORAGE_BUCKET'],
  ['VITE_OKVEVO_FIREBASE_MESSAGING_SENDER_ID', 'VITE_OKVEVO_FIREBASE_MESSAGING_SENDER_ID'],
  ['VITE_OKVEVO_FIREBASE_APP_ID', 'VITE_OKVEVO_FIREBASE_APP_ID']
]

export function mappedPackEnv(packTarget, env = process.env) {
  const prefix = TARGET_PREFIX[packTarget]
  if (!prefix) {
    throw new Error(`pack_target must be staging or production, got ${JSON.stringify(packTarget)}`)
  }

  const out = { NIA_UPDATE_CHANNEL: 'latest' }
  for (const [dest, suffix] of MAPPED_KEYS) {
    out[dest] = String(env[`${prefix}_${suffix}`] ?? '').trim()
  }
  return out
}

export function formatGithubEnv(vars) {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n'
}

const isMain = process.argv[1] && process.argv[1].endsWith('ci-map-pack-env.mjs')

if (isMain) {
  try {
    const mapped = mappedPackEnv(process.env.PACK_TARGET)
    const dest = process.env.GITHUB_ENV
    const text = formatGithubEnv(mapped)
    if (dest) {
      fs.appendFileSync(dest, text)
    } else {
      process.stdout.write(text)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
