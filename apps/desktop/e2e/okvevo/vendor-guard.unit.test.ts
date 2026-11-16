import assert from 'node:assert/strict'

import { test } from 'vitest'

import { noteRequestUrl } from './vendor-guard'

test('rejects openrouter.ai and another paid vendor host', () => {
  assert.throws(() => noteRequestUrl('https://openrouter.ai/api/v1/chat/completions'), /openrouter\.ai/)
  assert.throws(() => noteRequestUrl('https://api.fal.run/v1/run'), /fal\.run/)
})

test('allows OkVevo and the release feed; denies Firebase hosts', () => {
  assert.doesNotThrow(() => noteRequestUrl('https://www.okvevo.com/nia'))
  assert.doesNotThrow(() => noteRequestUrl('https://releases.okvevo.com/okvevo/staging/OkVevo-mac-arm64.dmg'))
  assert.doesNotThrow(() => noteRequestUrl('https://example.com/docs'))
  assert.throws(() => noteRequestUrl('https://identitytoolkit.googleapis.com/v1/accounts'), /identitytoolkit/)
  assert.throws(() => noteRequestUrl('https://firestore.googleapis.com/v1/projects/okvevo-testing'), /firestore/)
  assert.throws(() => noteRequestUrl('https://securetoken.googleapis.com/v1/token'), /securetoken/)
})
