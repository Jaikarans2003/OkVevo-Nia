import assert from 'node:assert/strict'

import { test } from 'vitest'

import { completeOkvevoAuthCallback, signOutOkvevo, startOkvevoSignIn, type OkvevoAuthFlowDeps } from './okvevo-auth-flow'
import type { OkvevoAuthSession } from './okvevo-auth'
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
        email: 'a@b.c'
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
  assert.equal(JSON.stringify(snap).includes('rt'), false)
  assert.equal(d.loadSession()?.idToken, 'idt')
})

test('mismatched state does not POST exchange', async () => {
  const d = deps()

  await startOkvevoSignIn(d)
  await assert.rejects(() => completeOkvevoAuthCallback('one-time-code', 'other-state', d), /invalid_state/)
  assert.equal(d.posts.length, 0)
  assert.equal(d.loadSession(), null)
})

test('signOut clears session', async () => {
  const d = deps()

  await startOkvevoSignIn(d)
  await completeOkvevoAuthCallback('one-time-code', 'csrf-state-value', d)
  const snap = signOutOkvevo(d)

  assert.equal(snap.signedIn, false)
  assert.equal(d.loadSession(), null)
})
