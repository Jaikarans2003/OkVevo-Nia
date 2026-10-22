/**
 * Stamp electron-builder extraMetadata.version as major.minor.{github.run_number}.
 * Avoids semver prerelease names that would make detectUpdateChannel rename yml files.
 *
 * Production tag packs use versionFromTag (vX.Y.Z only) instead of run_number.
 */
const STRICT_XYZ = /^(\d+)\.(\d+)\.(\d+)$/

export function ciDesktopVersion(packageVersion, runNumber) {
  const parts = String(packageVersion || '')
    .trim()
    .split('.')
  const major = parts[0]
  const minor = parts[1]
  const n = Number(runNumber)
  if (!/^\d+$/.test(major || '') || !/^\d+$/.test(minor || '')) {
    throw new Error(`package.json version must be major.minor.patch, got ${JSON.stringify(packageVersion)}`)
  }
  // Drop prerelease/build suffixes on the patch segment so CI never emits
  // 0.17.0-internal.N (electron-builder detectUpdateChannel would rename yml).
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`GITHUB_RUN_NUMBER must be a positive integer, got ${JSON.stringify(runNumber)}`)
  }
  return `${major}.${minor}.${n}`
}

export function versionFromTag(input) {
  const raw = String(input || '').trim()
  const name = raw.replace(/^refs\/tags\//, '')
  const unprefixed = name.startsWith('v') ? name.slice(1) : name
  if (!STRICT_XYZ.test(unprefixed)) {
    throw new Error(`tag must be vX.Y.Z (no prerelease), got ${JSON.stringify(input)}`)
  }
  return unprefixed
}

const isMain = process.argv[1] && process.argv[1].endsWith('ci-desktop-version.mjs')

if (isMain) {
  if (process.argv[2] === '--from-tag') {
    process.stdout.write(versionFromTag(process.argv[3] || process.env.GITHUB_REF_NAME || process.env.GITHUB_REF))
  } else {
    const pkg = process.argv[2]
    const run = process.argv[3] || process.env.GITHUB_RUN_NUMBER
    process.stdout.write(ciDesktopVersion(pkg, run))
  }
}
