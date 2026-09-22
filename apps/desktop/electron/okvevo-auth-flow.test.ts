import assert from 'node:assert/strict'

import { test } from 'vitest'

import { OKVEVO_INVALID_PORTAL_URL, type OkvevoAuthSession, PENDING_TTL_MS } from './okvevo-auth'
import { completeOkvevoAuthCallback, type OkvevoAuthFlowDeps, signOutOkvevo, startOkvevoSignIn } from './okvevo-auth-flow'
import type { OkvevoAuthPending } from './okvevo-auth-store'

function deps(overrides: Partial<OkvevoAuthFlowDeps> = {}): OkvevoAuthFlowDeps & {
  opened: string[]
  posts: { url: string; body: unknown }[]
  idTokenFile: string | null
} {
  let pending: OkvevoAuthPending | null = null
  let session: OkvevoAuthSession | null = null
  const opened: string[] = []
  const posts: { url: string; body: unknown }[] = []
  let idTokenFile: string | null = null

  const base: OkvevoAuthFlowDeps = {
    now: () => 1_000,
    generateState: () => 'csrf-state-value',
    protocol: 'hermes-dev',
    webOrigin: 'http://localhost:3000',
    postJson: async (url, body) => {
      posts.push({ url, body })

      return {
        refreshToken: 'rt',
        idToken: 'idt',
        expiresIn: 3600,
        uid: 'u1',
        email: 'a@b.c',
        displayName: 'Ada'
      }
    },
    openExternal: async url => {
      opened.push(url)
    },
    persistSession: next => {
      session = next
    },
    loadSession: () => session,
    setPending: next => {
      pending = next
    },
    getPending: () => pending,
    writeIdTokenFile: token => {
      idTokenFile = token
    },
    clearIdTokenFile: () => {
      idTokenFile = null
    }
  }

  return { ...base, ...overrides, opened, posts, idTokenFile: idTokenFile }
}

test('startOkvevoSignIn opens login with hermes-dev redirect and stores pending state', async () => {
  const d = deps()
  const url = await startOkvevoSignIn(d)
  const parsed = new URL(url)

  assert.equal(parsed.searchParams.get('redirect'), 'hermes-dev://auth-callback')
  assert.equal(parsed.searchParams.get('state'), 'csrf-state-value')
  assert.equal(d.opened.length, 1)
  assert.equal(d.getPending()?.state, 'csrf-state-value')
})

test('completeOkvevoAuthCallback exchanges matching state and hides tokens from the snapshot', async () => {
  const d = deps()

  await startOkvevoSignIn(d)
  const snap = await completeOkvevoAuthCallback('one-time-code', 'csrf-state-value', d)

  assert.equal(d.posts.length, 1)
  assert.equal(d.posts[0].url, 'http://localhost:3000/api/auth/desktop/exchange')
  assert.deepEqual(d.posts[0].body, { code: 'one-time-code', state: 'csrf-state-value' })
  assert.equal(snap.signedIn, true)
  assert.equal(snap.uid, 'u1')
  assert.equal(snap.email, 'a@b.c')
  assert.equal(snap.displayName, 'Ada')
  assert.equal(JSON.stringify(snap).includes('rt'), false)
  assert.equal(d.loadSession()?.idToken, 'idt')
})

test('completeOkvevoAuthCallback notifies from the in-memory session even if loadSession returns null', async () => {
  const d = deps({ loadSession: () => null })

  await startOkvevoSignIn(d)
  const snap = await completeOkvevoAuthCallback('one-time-code', 'csrf-state-value', d)

  assert.equal(snap.signedIn, true)
  assert.equal(snap.uid, 'u1')
  assert.equal(snap.email, 'a@b.c')
})

test('mismatched state does not POST exchange', async () => {
  const d = deps()

  await startOkvevoSignIn(d)
  await assert.rejects(() => completeOkvevoAuthCallback('one-time-code', 'other-state', d), /invalid_state/)
  assert.equal(d.posts.length, 0)
  assert.equal(d.loadSession(), null)
})

test('invalid portal URL throws before pending state or the browser', async () => {
  const d = deps({ webOrigin: 'www.okvevo.com' })

  await assert.rejects(() => startOkvevoSignIn(d), new RegExp(OKVEVO_INVALID_PORTAL_URL))
  assert.equal(d.opened.length, 0)
  assert.equal(d.getPending(), null)
})

test('expiry with no callback clears that pending sign-in, signals the dialog, and a second Sign In works', async () => {
  let n = 0
  const timers: Array<{ ms: number; fn: () => void }> = []
  let signals = 0

  const d = deps({
    generateState: () => `state-${++n}`,
    scheduleTimeout: (ms, fn) => {
      timers.push({ ms, fn })

      return () => {}
    },
    onSignInExpired: () => {
      signals += 1
    }
  })

  await startOkvevoSignIn(d)
  assert.equal(timers[0].ms, PENDING_TTL_MS)
  timers[0].fn()
  assert.equal(d.getPending(), null)
  assert.equal(signals, 1)

  const url = await startOkvevoSignIn(d)

  assert.ok(url)
  assert.equal(d.getPending()?.state, 'state-2')
  assert.equal(signals, 1)
})

test('an earlier sign-in timer does not clear a newer pending state', async () => {
  let n = 0
  const timers: Array<() => void> = []
  let signals = 0

  const d = deps({
    generateState: () => `state-${++n}`,
    scheduleTimeout: (_ms, fn) => {
      timers.push(fn)

      return () => {}
    },
    onSignInExpired: () => {
      signals += 1
    }
  })

  await startOkvevoSignIn(d)
  await startOkvevoSignIn(d)
  timers[0]()
  assert.equal(d.getPending()?.state, 'state-2')
  assert.equal(signals, 0)
  timers[1]()
  assert.equal(d.getPending(), null)
  assert.equal(signals, 1)
})

test('a successful callback does not fire the sign-in timeout dialog', async () => {
  const timers: Array<() => void> = []
  let signals = 0

  const d = deps({
    scheduleTimeout: (_ms, fn) => {
      timers.push(fn)

      return () => {}
    },
    onSignInExpired: () => {
      signals += 1
    }
  })

  await startOkvevoSignIn(d)
  await completeOkvevoAuthCallback('one-time-code', 'csrf-state-value', d)
  timers[0]()
  assert.equal(signals, 0)
  assert.equal(d.loadSession()?.uid, 'u1')
})

test('exchange timeout clears only the pending sign-in that failed', async () => {
  const d = deps({
    postJson: async () => {
      throw new Error('Timed out connecting to Nia after 15000ms')
    }
  })

  await startOkvevoSignIn(d)
  await assert.rejects(() => completeOkvevoAuthCallback('c', 'csrf-state-value', d), /Timed out/)
  assert.equal(d.getPending(), null)
})

test('exchange timeout does not clear a newer pending sign-in', async () => {
  let duringPost: (() => void) | undefined

  const d = deps({
    postJson: async () => {
      duringPost?.()
      throw new Error('Timed out connecting to Nia after 15000ms')
    }
  })

  await startOkvevoSignIn(d)
  const started = d.getPending()

  duringPost = () => {
    d.setPending({ state: 'newer', exp: (started?.exp ?? 0) + 1 })
  }

  await assert.rejects(() => completeOkvevoAuthCallback('c', 'csrf-state-value', d), /Timed out/)
  assert.equal(d.getPending()?.state, 'newer')
})

test('invalid_grant clears the matching pending sign-in', async () => {
  const d = deps({
    postJson: async () => ({})
  })

  await startOkvevoSignIn(d)
  await assert.rejects(() => completeOkvevoAuthCallback('c', 'csrf-state-value', d), /invalid_grant/)
  assert.equal(d.getPending(), null)
})

test('signOut clears session', async () => {
  const d = deps()

  await startOkvevoSignIn(d)
  await completeOkvevoAuthCallback('one-time-code', 'csrf-state-value', d)
  const snap = signOutOkvevo(d)

  assert.equal(snap.signedIn, false)
  assert.equal(d.loadSession(), null)
})
