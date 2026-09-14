import assert from 'node:assert/strict'
import { test } from 'vitest'

import { formatGithubEnv, mappedPackEnv } from './ci-map-pack-env.mjs'

test('staging maps STAGING_ prefix and defaults channel latest', () => {
  const mapped = mappedPackEnv('staging', {
    STAGING_OKVEVO_WEB_ORIGIN: 'https://test.example/',
    STAGING_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging',
    STAGING_VITE_OKVEVO_FIREBASE_API_KEY: 'AIza',
    STAGING_VITE_OKVEVO_FIREBASE_AUTH_DOMAIN: 't.firebaseapp.com',
    STAGING_VITE_OKVEVO_FIREBASE_PROJECT_ID: 'okvevo-testing',
    STAGING_VITE_OKVEVO_FIREBASE_STORAGE_BUCKET: 't.appspot.com',
    STAGING_VITE_OKVEVO_FIREBASE_MESSAGING_SENDER_ID: '1',
    STAGING_VITE_OKVEVO_FIREBASE_APP_ID: '1:1:web:a',
    PROD_OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com'
  })
  assert.equal(mapped.OKVEVO_WEB_ORIGIN, 'https://test.example/')
  assert.equal(mapped.NIA_UPDATE_FEED_URL, 'https://releases.okvevo.com/staging')
  assert.equal(mapped.NIA_UPDATE_CHANNEL, 'latest')
  assert.equal(mapped.VITE_OKVEVO_FIREBASE_PROJECT_ID, 'okvevo-testing')
})

test('production maps PROD_ and ignores staging', () => {
  const mapped = mappedPackEnv('production', {
    STAGING_OKVEVO_WEB_ORIGIN: 'https://test.example',
    PROD_OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com',
    PROD_UPDATE_FEED_URL: 'https://releases.okvevo.com'
  })
  assert.equal(mapped.OKVEVO_WEB_ORIGIN, 'https://www.okvevo.com')
  assert.equal(mapped.NIA_UPDATE_FEED_URL, 'https://releases.okvevo.com')
})

test('rejects unknown target', () => {
  assert.throws(() => mappedPackEnv('internal'), /staging or production/)
})

test('github env format is KEY=value lines', () => {
  assert.equal(formatGithubEnv({ A: '1', B: '2' }), 'A=1\nB=2\n')
})
