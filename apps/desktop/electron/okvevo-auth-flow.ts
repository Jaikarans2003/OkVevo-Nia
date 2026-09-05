/**
 * OkVevo sign-in orchestration. Deps injected so the round trip unit-tests
 * without Electron (same pattern as native-oauth-login.ts).
 */

import {
  buildOkvevoLoginUrl,
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
}

function notify(deps: OkvevoAuthFlowDeps, session: OkvevoAuthSession | null): OkvevoAuthPublic {
  const snapshot = publicOkvevoAuthSnapshot(session)

  deps.onChange?.(snapshot)

  return snapshot
}

export async function startOkvevoSignIn(deps: OkvevoAuthFlowDeps): Promise<string> {
  const state = deps.generateState()

  deps.setPending({ state, exp: deps.now() + PENDING_TTL_MS })

  const url = buildOkvevoLoginUrl({ origin: deps.webOrigin, protocol: deps.protocol, state })

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

  const body = await deps.postJson(`${deps.webOrigin.replace(/\/$/, '')}/api/auth/desktop/exchange`, { code, state })
  const session = sessionFromTokenResponse(body as Parameters<typeof sessionFromTokenResponse>[0], deps.now())

  if (!session) {
    throw new Error('invalid_grant')
  }

  deps.persistSession(session)
  deps.setPending(null)
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
