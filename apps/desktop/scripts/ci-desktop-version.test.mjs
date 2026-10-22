import assert from 'node:assert/strict'
import { test } from 'vitest'

import { ciDesktopVersion, versionFromTag } from './ci-desktop-version.mjs'

test('stamps major.minor.run_number and ignores a leftover prerelease suffix', () => {
  assert.equal(ciDesktopVersion('0.17.0', 42), '0.17.42')
  assert.equal(ciDesktopVersion('0.17.9', '100'), '0.17.100')
  assert.equal(ciDesktopVersion('0.17.0-internal.1', 5), '0.17.5')
})

test('rejects non-numeric major.minor and missing run numbers', () => {
  assert.throws(() => ciDesktopVersion('v0.17.0', 1), /major.minor.patch/)
  assert.throws(() => ciDesktopVersion('0.17.0', 0), /positive integer/)
  assert.throws(() => ciDesktopVersion('0.17.0', 'nope'), /positive integer/)
})

test('versionFromTag accepts vX.Y.Z and bare X.Y.Z', () => {
  assert.equal(versionFromTag('v0.17.15'), '0.17.15')
  assert.equal(versionFromTag('0.17.15'), '0.17.15')
  assert.equal(versionFromTag('refs/tags/v0.17.15'), '0.17.15')
})

test('versionFromTag rejects incomplete, named, and prerelease tags', () => {
  assert.throws(() => versionFromTag('v0.17'), /vX\.Y\.Z/)
  assert.throws(() => versionFromTag('release-1'), /vX\.Y\.Z/)
  assert.throws(() => versionFromTag('v0.17.15-beta.1'), /vX\.Y\.Z/)
  assert.throws(() => versionFromTag('v0.17.15-internal.1'), /vX\.Y\.Z/)
  assert.throws(() => versionFromTag(''), /vX\.Y\.Z/)
})
