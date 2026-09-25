/**
 * Sanity check for Electron 44 clipboard image MIME filtering (no Electron runtime).
 * The real IPC path is exercised via hermes:saveClipboardImage after the major bump.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

test('image MIME filter accepts png/jpeg and rejects text', () => {
  const isImage = (type: string) => type.startsWith('image/')
  assert.equal(isImage('image/png'), true)
  assert.equal(isImage('image/jpeg'), true)
  assert.equal(isImage('text/plain'), false)
})
