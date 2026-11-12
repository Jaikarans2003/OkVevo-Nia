import assert from 'node:assert/strict'

import { test } from 'vitest'

import { FEEDS, RELEASES_ORIGIN, feedFor } from './okvevo-feed-urls.mjs'

test('staging and production URLs are the okvevo folders', () => {
  assert.equal(feedFor('staging').url, 'https://releases.okvevo.com/okvevo/staging')
  assert.equal(feedFor('staging').prefix, 'okvevo/staging')
  assert.equal(feedFor('production').url, 'https://releases.okvevo.com/okvevo/stable')
  assert.equal(feedFor('production').prefix, 'okvevo/stable')
  for (const feed of Object.values(FEEDS)) {
    assert.equal(feed.url, `${RELEASES_ORIGIN}/${feed.prefix}`)
  }
})

test('rejects an unknown pack target', () => {
  assert.throws(() => feedFor('internal'), /staging or production/)
})
