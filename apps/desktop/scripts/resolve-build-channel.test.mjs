import assert from 'node:assert/strict'
import { test } from 'vitest'

import { resolveBuildChannel } from './resolve-build-channel.mjs'

test('unset env is public (pack/CI fail-closed)', () => {
  assert.equal(resolveBuildChannel({ env: {}, isDev: false }), 'public')
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: undefined }, isDev: false }), 'public')
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: '' }, isDev: false }), 'public')
})

test('exact internal is internal (build-machine env, including pack:internal)', () => {
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: 'internal' }, isDev: false }), 'internal')
})

test('anything other than exact internal is public', () => {
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: 'Internal' }, isDev: false }), 'public')
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: 'public' }, isDev: false }), 'public')
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: '1' }, isDev: false }), 'public')
})

test('vite-serve / --dev defaults internal when env is unset', () => {
  assert.equal(resolveBuildChannel({ env: {}, isDev: true }), 'internal')
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: '' }, isDev: true }), 'internal')
})

test('isDev does not override an explicit non-internal env (fail-closed)', () => {
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: 'public' }, isDev: true }), 'public')
  assert.equal(resolveBuildChannel({ env: { NIA_BUILD_CHANNEL: 'internal' }, isDev: true }), 'internal')
})
