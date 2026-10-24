import assert from 'node:assert/strict'

import { test } from 'vitest'

import { bakedFeedUrlFromPack, resolveDesktopFeedBase } from './okvevo-feed'

const STAGING = 'https://releases.okvevo.com/okvevo/staging'
const PRODUCTION = 'https://releases.okvevo.com/okvevo/stable'

test('config override wins over the baked channel URL', () => {
  assert.equal(resolveDesktopFeedBase('https://127.0.0.1:9/feed', STAGING), 'https://127.0.0.1:9/feed')
})

test('empty config uses the baked staging or production URL', () => {
  assert.equal(resolveDesktopFeedBase('', STAGING), STAGING)
  assert.equal(resolveDesktopFeedBase('   ', PRODUCTION), PRODUCTION)
})

test('empty config and empty bake is no feed', () => {
  assert.equal(resolveDesktopFeedBase('', ''), '')
})

test('baked URL is the pack file, not an env var', () => {
  assert.equal(bakedFeedUrlFromPack({ OKVEVO_UPDATE_FEED_URL: ` ${STAGING} ` }), STAGING)
  assert.equal(bakedFeedUrlFromPack(null), '')
})
