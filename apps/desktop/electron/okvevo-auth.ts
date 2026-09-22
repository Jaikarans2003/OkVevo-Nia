/**
 * Pure helpers for the OkVevo portal sign-in round trip.
 * No `import 'electron'` — unit-tested like native-oauth.ts.
 */

export const AUTH_CALLBACK_KIND = 'auth-callback'
export const OKVEVO_ID_TOKEN_FILENAME = 'okvevo-firebase-id-token'
export const PENDING_TTL_MS = 10 * 60 * 1000
export const OKVEVO_INVALID_PORTAL_URL = 'invalid_portal_url'
export const OKVEVO_ORIGIN_MISSING_TITLE = 'Nia is missing the OkVevo portal URL'
export const OKVEVO_ORIGIN_MISSING_ERROR =
  "Nia is missing the OkVevo portal URL. This build's pack-env is empty or unreadable. Reinstall the official Nia app."
export const OKVEVO_PORTAL_URL_INVALID_TITLE = 'Nia could not open OkVevo'
export const OKVEVO_PORTAL_URL_INVALID_ERROR =
  "Nia could not open the OkVevo sign-in page. This build's portal address is not a valid web URL. Reinstall the official Nia app."
export const OKVEVO_SIGN_IN_TIMEOUT_TITLE = 'Nia sign-in to OkVevo timed out'
export const OKVEVO_SIGN_IN_TIMEOUT_ERROR =
  'Nia did not receive the OkVevo sign-in callback in time. Click Sign In in Nia and try again.'
export const OKVEVO_SIGN_IN_FAILED_TITLE = 'Nia could not sign in to OkVevo'
export const OKVEVO_SIGN_IN_FAILED_ERROR =
  'Nia could not finish signing in to OkVevo. Click Sign In in Nia and try again.'
const PORTAL_PATH_RE = /^\/[A-Za-z0-9/_-]*$/

export type OkvevoAuthPublic = {
  signedIn: boolean
  uid: string | null
  email: string | null
  displayName: string | null
}

export type OkvevoAuthSession = {
  refreshToken: string
  idToken: string
  expiresAt: number
  uid: string
  email: string | null
  displayName: string | null
}

/** Best-effort `name` claim from a Firebase ID token (existing sessions). */
export function displayNameFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1]

    if (!payload) {
      return null
    }

    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const claims = JSON.parse(json) as { name?: unknown }
    const name = typeof claims.name === 'string' ? claims.name.trim() : ''

    return name || null
  } catch {
    return null
  }
}

export function hermesProtocolForDev(devServer: boolean): 'hermes' | 'hermes-dev' {
  return devServer ? 'hermes-dev' : 'hermes'
}

export function resolveOkvevoWebOrigin(
  env: NodeJS.ProcessEnv = process.env,
  { devServer = false }: { devServer?: boolean } = {}
): string {
  const fromEnv = (env.OKVEVO_WEB_ORIGIN || '').trim().replace(/\/$/, '')

  if (fromEnv) {
    return fromEnv
  }

  if (devServer) {
    return 'http://localhost:3000'
  }

  return ''
}

export function isAllowedOkvevoPortalPath(portalPath: string): boolean {
  return PORTAL_PATH_RE.test(portalPath)
}

export function buildOkvevoPortalUrl(origin: string, portalPath: string): string | null {
  const trimmed = origin.replace(/\/$/, '')

  if (!trimmed || !isAllowedOkvevoPortalPath(portalPath)) {
    return null
  }

  return `${trimmed}${portalPath}`
}

export function buildOkvevoLoginUrl(opts: { origin: string; protocol: string; state: string }): string | null {
  const origin = opts.origin.replace(/\/$/, '')

  try {
    const url = new URL(`${origin}/login`)

    url.searchParams.set('redirect', `${opts.protocol}://${AUTH_CALLBACK_KIND}`)
    url.searchParams.set('state', opts.state)

    return url.toString()
  } catch {
    return null
  }
}

export function parseHermesAuthCallback(url: string): { code: string; state: string } | null {
  try {
    const parsed = new URL(url)
    const kind = parsed.hostname || ''

    if (kind !== AUTH_CALLBACK_KIND) {
      return null
    }

    const code = parsed.searchParams.get('code') || ''
    const state = parsed.searchParams.get('state') || ''

    if (!code || !state) {
      return null
    }

    return { code, state }
  } catch {
    return null
  }
}

export function shouldDeliverDeepLinkToRenderer(kind: string): boolean {
  return kind !== AUTH_CALLBACK_KIND
}

export function publicOkvevoAuthSnapshot(session: OkvevoAuthSession | null): OkvevoAuthPublic {
  if (!session?.uid) {
    return { signedIn: false, uid: null, email: null, displayName: null }
  }

  const displayName = session.displayName?.trim() || displayNameFromIdToken(session.idToken)

  return { signedIn: true, uid: session.uid, email: session.email, displayName }
}

export function okvevoIdTokenFilePath(
  hermesHome: string,
  pathJoin: (...parts: string[]) => string = (...parts) => parts.join('/')
): string {
  return pathJoin(hermesHome, OKVEVO_ID_TOKEN_FILENAME)
}

export function sessionFromTokenResponse(
  body: {
    refreshToken?: string
    idToken?: string
    expiresIn?: number | string
    uid?: string
    email?: string | null
    displayName?: string | null
  },
  now = Date.now()
): OkvevoAuthSession | null {
  if (!body.refreshToken || !body.idToken || !body.uid) {
    return null
  }

  const expiresIn = Number(body.expiresIn) || 3600
  const fromBody = typeof body.displayName === 'string' ? body.displayName.trim() : ''

  return {
    refreshToken: body.refreshToken,
    idToken: body.idToken,
    expiresAt: now + expiresIn * 1000,
    uid: body.uid,
    email: body.email ?? null,
    displayName: fromBody || displayNameFromIdToken(body.idToken)
  }
}

export function refreshDelayMs(expiresAt: number, now = Date.now()): number {
  return Math.max(30_000, expiresAt - now - 5 * 60_000)
}
