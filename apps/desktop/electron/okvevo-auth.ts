/**
 * Pure helpers for the OkVevo portal sign-in round trip.
 * No `import 'electron'` — unit-tested like native-oauth.ts.
 */

export const AUTH_CALLBACK_KIND = 'auth-callback'
export const OKVEVO_ID_TOKEN_FILENAME = 'okvevo-firebase-id-token'
export const PENDING_TTL_MS = 10 * 60 * 1000
export const OKVEVO_ORIGIN_MISSING_TITLE = 'OkVevo portal URL missing'
export const OKVEVO_ORIGIN_MISSING_ERROR =
  'Nia is missing the OkVevo portal URL. Set OKVEVO_WEB_ORIGIN in ~/.hermes/.env and restart Nia.'
const PORTAL_PATH_RE = /^\/[A-Za-z0-9/_-]*$/

export type OkvevoAuthPublic = {
  signedIn: boolean
  uid: string | null
  email: string | null
}

export type OkvevoAuthSession = {
  refreshToken: string
  idToken: string
  expiresAt: number
  uid: string
  email: string | null
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

export function buildOkvevoLoginUrl(opts: { origin: string; protocol: string; state: string }): string {
  const origin = opts.origin.replace(/\/$/, '')
  const url = new URL(`${origin}/login`)

  url.searchParams.set('redirect', `${opts.protocol}://${AUTH_CALLBACK_KIND}`)
  url.searchParams.set('state', opts.state)

  return url.toString()
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
    return { signedIn: false, uid: null, email: null }
  }

  return { signedIn: true, uid: session.uid, email: session.email }
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
  },
  now = Date.now()
): OkvevoAuthSession | null {
  if (!body.refreshToken || !body.idToken || !body.uid) {
    return null
  }

  const expiresIn = Number(body.expiresIn) || 3600

  return {
    refreshToken: body.refreshToken,
    idToken: body.idToken,
    expiresAt: now + expiresIn * 1000,
    uid: body.uid,
    email: body.email ?? null
  }
}

export function refreshDelayMs(expiresAt: number, now = Date.now()): number {
  return Math.max(30_000, expiresAt - now - 5 * 60_000)
}
