import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  AUTH_CALLBACK_KIND,
  buildOkvevoLoginUrl,
  buildOkvevoPortalUrl,
  hermesProtocolForDev,
  isAllowedOkvevoPortalPath,
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

test('web origin: env wins, else localhost in dev, else empty', () => {
  assert.equal(resolveOkvevoWebOrigin({}, { devServer: false }), '')
  assert.equal(resolveOkvevoWebOrigin({}, { devServer: true }), 'http://localhost:3000')
  assert.equal(
    resolveOkvevoWebOrigin({ OKVEVO_WEB_ORIGIN: 'https://staging.example/' }, { devServer: true }),
    'https://staging.example'
  )
})

test('portal path allowlist and Upgrade URL', () => {
  assert.equal(isAllowedOkvevoPortalPath('/billing'), true)
  assert.equal(isAllowedOkvevoPortalPath('/billing/plans'), true)
  assert.equal(isAllowedOkvevoPortalPath('/billing/change-plan'), true)
  assert.equal(isAllowedOkvevoPortalPath('/billing/cancel'), true)
  assert.equal(isAllowedOkvevoPortalPath('/billing/upgrade'), true)
  assert.equal(isAllowedOkvevoPortalPath('/pricing'), true)
  assert.equal(isAllowedOkvevoPortalPath('billing'), false)
  assert.equal(isAllowedOkvevoPortalPath('https://evil.example/billing'), false)
  assert.equal(isAllowedOkvevoPortalPath('/billing?x=1'), false)
  assert.equal(buildOkvevoPortalUrl('https://staging.example/', '/billing'), 'https://staging.example/billing')
  assert.equal(
    buildOkvevoPortalUrl('https://okvevo-web--okvevo-testing.us-central1.hosted.app', '/billing/change-plan'),
    'https://okvevo-web--okvevo-testing.us-central1.hosted.app/billing/change-plan'
  )
  assert.equal(buildOkvevoPortalUrl('', '/billing'), null)
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
    email: 'a@b.c',
    displayName: 'Karan'
  })
  const json = JSON.stringify(snap)

  assert.equal(snap.signedIn, true)
  assert.equal(snap.uid, 'uid-1')
  assert.equal(snap.email, 'a@b.c')
  assert.equal(snap.displayName, 'Karan')
  assert.equal(json.includes('rt-secret'), false)
  assert.equal(json.includes('idt-secret'), false)
})

test('public snapshot reads name claim from id token when displayName missing', () => {
  const payload = Buffer.from(JSON.stringify({ name: 'From Token' })).toString('base64url')
  const snap = publicOkvevoAuthSnapshot({
    refreshToken: 'rt',
    idToken: `hdr.${payload}.sig`,
    expiresAt: 9,
    uid: 'uid-1',
    email: 'a@b.c',
    displayName: null
  })

  assert.equal(snap.displayName, 'From Token')
})

test('sessionFromTokenResponse requires tokens + uid', () => {
  assert.equal(sessionFromTokenResponse({}), null)
  const session = sessionFromTokenResponse(
    {
      refreshToken: 'rt',
      idToken: 'idt',
      expiresIn: 3600,
      uid: 'u1',
      email: 'e',
      displayName: 'Ada'
    },
    1_000
  )

  assert.equal(session?.expiresAt, 1_000 + 3600 * 1000)
  assert.equal(session?.uid, 'u1')
  assert.equal(session?.displayName, 'Ada')
})

test('refreshDelayMs floors at 30s and wakes 5min before expiry', () => {
  assert.equal(refreshDelayMs(1_000, 0), 30_000)
  assert.equal(refreshDelayMs(20 * 60 * 1000, 0), 15 * 60 * 1000)
})
