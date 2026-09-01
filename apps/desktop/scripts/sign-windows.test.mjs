import assert from 'node:assert/strict'

import { test } from 'vitest'

import { windowsSigningReady } from './sign-windows.mjs'

test('windowsSigningReady needs both link and password', () => {
  assert.equal(windowsSigningReady({}), false)
  assert.equal(windowsSigningReady({ WIN_CSC_LINK: 'x' }), false)
  assert.equal(windowsSigningReady({ WIN_CSC_KEY_PASSWORD: 'x' }), false)
  assert.equal(windowsSigningReady({ WIN_CSC_LINK: 'x', WIN_CSC_KEY_PASSWORD: 'x' }), true)
})
