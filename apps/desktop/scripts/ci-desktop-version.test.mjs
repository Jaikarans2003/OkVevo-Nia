import assert from 'node:assert/strict'
import { test } from 'vitest'

import { ciDesktopVersion } from './ci-desktop-version.mjs'

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
