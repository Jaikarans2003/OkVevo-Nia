import assert from 'node:assert/strict'
import { test } from 'vitest'

import { formatGithubEnv, mappedPackEnv } from './ci-map-pack-env.mjs'

test('staging maps STAGING_ prefix and defaults channel latest', () => {
  const mapped = mappedPackEnv('staging', {
    STAGING_OKVEVO_WEB_ORIGIN: 'https://test.example/',
    PROD_OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com'
  })
  assert.equal(mapped.OKVEVO_WEB_ORIGIN, 'https://test.example/')
  assert.equal(mapped.OKVEVO_UPDATE_FEED_URL, 'https://releases.okvevo.com/okvevo/staging')
  assert.equal(mapped.OKVEVO_UPDATE_CHANNEL, 'latest')
  assert.equal(mapped.CLOUDFLARE_R2_PUBLIC_URL, 'https://releases.okvevo.com')
  assert.equal(mapped.VITE_OKVEVO_FIREBASE_PROJECT_ID, undefined)
})

test('production maps PROD_ and ignores staging', () => {
  const mapped = mappedPackEnv('production', {
    STAGING_OKVEVO_WEB_ORIGIN: 'https://test.example',
    PROD_OKVEVO_WEB_ORIGIN: 'https://www.okvevo.com'
  })
  assert.equal(mapped.OKVEVO_WEB_ORIGIN, 'https://www.okvevo.com')
  assert.equal(mapped.OKVEVO_UPDATE_FEED_URL, 'https://releases.okvevo.com/okvevo/stable')
  assert.equal(mapped.CLOUDFLARE_R2_PUBLIC_URL, 'https://releases.okvevo.com')
})

test('rejects unknown target', () => {
  assert.throws(() => mappedPackEnv('internal'), /staging or production/)
})

test('github env format is KEY=value lines', () => {
  assert.equal(formatGithubEnv({ A: '1', B: '2' }), 'A=1\nB=2\n')
})
