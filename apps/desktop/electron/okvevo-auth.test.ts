import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  AUTH_CALLBACK_KIND,
  buildOkvevoLoginUrl,
  hermesProtocolForDev,
  parseHermesAuthCallback,
  publicOkvevoAuthSnapshot,
  refreshDelayMs,
  resolveOkvevoWebOrigin,
  sessionFromTokenResponse,
  shouldDeliverDeepLinkToRenderer
} from './okvevo-auth'

test('dev protocol is hermes-dev; packaged is hermes', () => {
  assert.equal(hermesProtocolForDev(true), 'hermes-dev')
  assert.equal(hermesProtocolForDev(false), 'hermes')
})

test('web origin: env wins, else localhost in dev, else www', () => {
  assert.equal(resolveOkvevoWebOrigin({}, { devServer: false }), 'https://www.okvevo.com')
  assert.equal(resolveOkvevoWebOrigin({}, { devServer: true }), 'http://localhost:3000')
  assert.equal(
    resolveOkvevoWebOrigin({ OKVEVO_WEB_ORIGIN: 'https://staging.example/' }, { devServer: true }),
    'https://staging.example'
  )
})

test('login URL carries allowlisted redirect + state', () => {
  const url = buildOkvevoLoginUrl({
    origin: 'https://www.okvevo.com',
    protocol: 'hermes-dev',
    state: 'csrf-state-value'
  })
  const parsed = new URL(url)

  assert.equal(parsed.origin, 'https://www.okvevo.com')
  assert.equal(parsed.pathname, '/login')
  assert.equal(parsed.searchParams.get('redirect'), 'hermes-dev://auth-callback')
  assert.equal(parsed.searchParams.get('state'), 'csrf-state-value')
})

test('parses hermes://auth-callback?code&state', () => {
  assert.deepEqual(parseHermesAuthCallback('hermes://auth-callback?code=abc&state=xyz'), {
    code: 'abc',
    state: 'xyz'
  })
  assert.deepEqual(parseHermesAuthCallback('hermes-dev://auth-callback?code=c1&state=s1'), {
    code: 'c1',
    state: 's1'
  })
  assert.equal(parseHermesAuthCallback('hermes://mcp/install?name=x'), null)
  assert.equal(parseHermesAuthCallback('hermes://auth-callback?state=only'), null)
  assert.equal(parseHermesAuthCallback('not-a-url'), null)
})

test('auth-callback is never delivered to the renderer as a navigate', () => {
  assert.equal(shouldDeliverDeepLinkToRenderer(AUTH_CALLBACK_KIND), false)
  assert.equal(shouldDeliverDeepLinkToRenderer('mcp'), true)
  assert.equal(shouldDeliverDeepLinkToRenderer('plugin'), true)
})

test('public snapshot never includes tokens', () => {
  const snap = publicOkvevoAuthSnapshot({
    refreshToken: 'rt-secret',
    idToken: 'idt-secret',
    expiresAt: 9,
    uid: 'uid-1',
    email: 'a@b.c'
  })
  const json = JSON.stringify(snap)

  assert.equal(snap.signedIn, true)
  assert.equal(snap.uid, 'uid-1')
  assert.equal(snap.email, 'a@b.c')
  assert.equal(json.includes('rt-secret'), false)
  assert.equal(json.includes('idt-secret'), false)
})

test('sessionFromTokenResponse requires tokens + uid', () => {
  assert.equal(sessionFromTokenResponse({}), null)
  const session = sessionFromTokenResponse(
    { refreshToken: 'rt', idToken: 'idt', expiresIn: 3600, uid: 'u1', email: 'e' },
    1_000
  )

  assert.equal(session?.expiresAt, 1_000 + 3600 * 1000)
  assert.equal(session?.uid, 'u1')
})

test('refreshDelayMs floors at 30s and wakes 5min before expiry', () => {
  assert.equal(refreshDelayMs(1_000, 0), 30_000)
  assert.equal(refreshDelayMs(20 * 60 * 1000, 0), 15 * 60 * 1000)
})
