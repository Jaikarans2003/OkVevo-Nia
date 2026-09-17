/**
 * Fail-closed gate for packaged desktop releases.
 *
 * Production: missing Apple, Windows, or feed-upload secrets must exit 1 so
 * CI never publishes an unsigned latest.yml.
 * Staging: `--allow-unsigned` / NIA_ALLOW_UNSIGNED=1 checks feed secrets only.
 * Local `npm run pack` does not run this.
 *
 * Usage: node scripts/require-release-secrets.mjs [--allow-unsigned]
 */
export const REQUIRED_SIGNING_SECRETS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD'
]

export const REQUIRED_FEED_SECRETS = [
  'RELEASES_S3_BUCKET',
  'RELEASES_S3_ACCESS_KEY_ID',
  'RELEASES_S3_SECRET_ACCESS_KEY'
]

export const REQUIRED_RELEASE_SECRETS = [...REQUIRED_SIGNING_SECRETS, ...REQUIRED_FEED_SECRETS]

export function unsignedPackAllowed(env = process.env, argv = process.argv.slice(2)) {
  return argv.includes('--allow-unsigned') || String(env.NIA_ALLOW_UNSIGNED ?? '').trim() === '1'
}

export function missingReleaseSecrets(env = process.env, options = {}) {
  const names = options.allowUnsigned ? REQUIRED_FEED_SECRETS : REQUIRED_RELEASE_SECRETS
  return names.filter(name => !String(env[name] ?? '').trim())
}

export function formatMissingReleaseSecrets(missing) {
  return [
    'Packaged Nia releases are fail-closed: missing signing or feed secrets.',
    `Unset: ${missing.join(', ')}`,
    'See docs/FINISH-SIGNED-RELEASE.md and docs/CI-CD.md.'
  ].join('\n')
}

const isMain = process.argv[1] && process.argv[1].endsWith('require-release-secrets.mjs')

if (isMain) {
  const allowUnsigned = unsignedPackAllowed()
  const missing = missingReleaseSecrets(process.env, { allowUnsigned })

  if (missing.length) {
    console.error(formatMissingReleaseSecrets(missing))
    process.exit(1)
  }

  console.log(
    allowUnsigned
      ? 'Feed secrets present (unsigned pack allowed; values not printed).'
      : 'Release secrets present (values not printed).'
  )
}
