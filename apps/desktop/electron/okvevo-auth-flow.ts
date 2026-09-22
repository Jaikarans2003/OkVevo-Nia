/**
 * OkVevo sign-in orchestration. Deps injected so the round trip unit-tests
 * without Electron (same pattern as native-oauth-login.ts).
 */

import {
  buildOkvevoLoginUrl,
  OKVEVO_INVALID_PORTAL_URL,
  type OkvevoAuthPublic,
  type OkvevoAuthSession,
  PENDING_TTL_MS,
  publicOkvevoAuthSnapshot,
  sessionFromTokenResponse
} from './okvevo-auth'
import type { OkvevoAuthPending } from './okvevo-auth-store'

export interface OkvevoAuthFlowDeps {
  now: () => number
  generateState: () => string
  protocol: 'hermes' | 'hermes-dev'
  webOrigin: string
  postJson: (url: string, body: unknown) => Promise<unknown>
  openExternal: (url: string) => Promise<void>
  persistSession: (session: OkvevoAuthSession | null) => void
  loadSession: () => OkvevoAuthSession | null
  setPending: (pending: OkvevoAuthPending | null) => void
  getPending: () => OkvevoAuthPending | null
  writeIdTokenFile: (idToken: string) => void
  clearIdTokenFile: () => void
  rememberLog?: (message: string) => void
  onChange?: (snapshot: OkvevoAuthPublic) => void
  scheduleTimeout?: (ms: number, fn: () => void) => () => void
  onSignInExpired?: () => void
}

type ArmedSignIn = { state: string; exp: number; cancel: () => void }

let armedSignIn: ArmedSignIn | null = null

function defaultScheduleTimeout(ms: number, fn: () => void): () => void {
  const id = setTimeout(fn, ms)

  if (typeof id.unref === 'function') {
    id.unref()
  }

  return () => clearTimeout(id)
}

function disarmSignInTimer(state: string, exp: number): void {
  if (!armedSignIn || armedSignIn.state !== state || armedSignIn.exp !== exp) {
    return
  }

  armedSignIn.cancel()
  armedSignIn = null
}

function pendingMatches(pending: OkvevoAuthPending | null, state: string, exp: number): pending is OkvevoAuthPending {
  return Boolean(pending && pending.state === state && pending.exp === exp)
}

function armSignInTimer(deps: OkvevoAuthFlowDeps, state: string, exp: number): void {
  if (armedSignIn) {
    armedSignIn.cancel()
    armedSignIn = null
  }

  const schedule = deps.scheduleTimeout ?? defaultScheduleTimeout
  const delay = Math.max(0, exp - deps.now())

  const cancel = schedule(delay, () => {
    if (armedSignIn?.state === state && armedSignIn.exp === exp) {
      armedSignIn = null
    }

    const pending = deps.getPending()

    if (!pendingMatches(pending, state, exp)) {
      return
    }

    deps.setPending(null)
    deps.onSignInExpired?.()
  })

  armedSignIn = { state, exp, cancel }
}

function clearPendingIfSame(deps: OkvevoAuthFlowDeps, state: string, exp: number): void {
  const pending = deps.getPending()

  if (!pendingMatches(pending, state, exp)) {
    return
  }

  disarmSignInTimer(state, exp)
  deps.setPending(null)
}

function notify(deps: OkvevoAuthFlowDeps, session: OkvevoAuthSession | null): OkvevoAuthPublic {
  const snapshot = publicOkvevoAuthSnapshot(session)

  deps.onChange?.(snapshot)

  return snapshot
}

export async function startOkvevoSignIn(deps: OkvevoAuthFlowDeps): Promise<string> {
  const state = deps.generateState()
  const url = buildOkvevoLoginUrl({ origin: deps.webOrigin, protocol: deps.protocol, state })

  if (!url) {
    throw new Error(OKVEVO_INVALID_PORTAL_URL)
  }

  const exp = deps.now() + PENDING_TTL_MS

  deps.setPending({ state, exp })
  armSignInTimer(deps, state, exp)

  await deps.openExternal(url)
  deps.rememberLog?.('[okvevo-auth] opened login')

  return url
}

export async function completeOkvevoAuthCallback(
  code: string,
  state: string,
  deps: OkvevoAuthFlowDeps
): Promise<OkvevoAuthPublic> {
  const pending = deps.getPending()

  if (!pending || pending.state !== state || pending.exp < deps.now()) {
    throw new Error('invalid_state')
  }

  const matched = { state: pending.state, exp: pending.exp }
  let body: unknown

  try {
    body = await deps.postJson(`${deps.webOrigin.replace(/\/$/, '')}/api/auth/desktop/exchange`, { code, state })
  } catch (error) {
    clearPendingIfSame(deps, matched.state, matched.exp)
    throw error
  }

  const session = sessionFromTokenResponse(body as Parameters<typeof sessionFromTokenResponse>[0], deps.now())

  if (!session) {
    clearPendingIfSame(deps, matched.state, matched.exp)
    throw new Error('invalid_grant')
  }

  deps.persistSession(session)
  clearPendingIfSame(deps, matched.state, matched.exp)
  deps.writeIdTokenFile(session.idToken)
  deps.rememberLog?.(`[okvevo-auth] signed in ${session.uid}`)

  return notify(deps, session)
}

export async function refreshOkvevoAuth(deps: OkvevoAuthFlowDeps): Promise<OkvevoAuthPublic> {
  const current = deps.loadSession()

  if (!current) {
    return publicOkvevoAuthSnapshot(null)
  }

  const body = await deps.postJson(`${deps.webOrigin.replace(/\/$/, '')}/api/auth/desktop/refresh`, {
    refreshToken: current.refreshToken
  })

  const session = sessionFromTokenResponse(body as Parameters<typeof sessionFromTokenResponse>[0], deps.now())

  if (!session) {
    throw new Error('invalid_grant')
  }

  deps.persistSession(session)
  deps.writeIdTokenFile(session.idToken)

  return notify(deps, session)
}

export function signOutOkvevo(deps: OkvevoAuthFlowDeps): OkvevoAuthPublic {
  deps.setPending(null)
  deps.persistSession(null)
  deps.clearIdTokenFile()
  deps.rememberLog?.('[okvevo-auth] signed out')

  return notify(deps, null)
}
