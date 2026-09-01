/**
 * Fail-closed gate for tagged desktop releases.
 *
 * Missing Apple, Windows, or feed-upload secrets must exit 1 so CI never
 * publishes an unsigned latest.yml. Local `npm run pack` does not run this.
 *
 * Usage: node scripts/require-release-secrets.mjs
 */
export const REQUIRED_RELEASE_SECRETS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'RELEASES_S3_BUCKET',
  'RELEASES_S3_ACCESS_KEY_ID',
  'RELEASES_S3_SECRET_ACCESS_KEY'
]

export function missingReleaseSecrets(env = process.env) {
  return REQUIRED_RELEASE_SECRETS.filter(name => !String(env[name] ?? '').trim())
}

export function formatMissingReleaseSecrets(missing) {
  return [
    'Tagged Nia releases are fail-closed: missing signing or feed secrets.',
    `Unset: ${missing.join(', ')}`,
    'Do not publish latest-mac.yml / latest.yml. See docs/FINISH-SIGNED-RELEASE.md.'
  ].join('\n')
}

const isMain = process.argv[1] && process.argv[1].endsWith('require-release-secrets.mjs')

if (isMain) {
  const missing = missingReleaseSecrets()

  if (missing.length) {
    console.error(formatMissingReleaseSecrets(missing))
    process.exit(1)
  }

  console.log('Release secrets present (values not printed).')
}
