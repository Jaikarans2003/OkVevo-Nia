/**
 * userData/okvevo-auth.json — one file, same encryptDesktopSecret envelope as
 * native-oauth-tokens.json. Pending CSRF state is plaintext (it also lives in
 * the login URL); the session blob is encrypted.
 */

import type { OkvevoAuthSession } from './okvevo-auth'

export interface StoredTokenSecret {
  encoding?: string
  value?: string
}

export interface OkvevoAuthStoreIo {
  encrypt: (plaintext: string) => StoredTokenSecret | null
  decrypt: (secret: unknown) => string
  readStoreText: () => string
  writeStoreText: (text: string) => void
  rememberLog?: (message: string) => void
}

export type OkvevoAuthPending = { state: string; exp: number }

export type OkvevoAuthFile = {
  pending?: OkvevoAuthPending
  secret?: StoredTokenSecret
}

function readFile(io: OkvevoAuthStoreIo): OkvevoAuthFile {
  try {
    const parsed = JSON.parse(io.readStoreText())

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeFile(io: OkvevoAuthStoreIo, next: OkvevoAuthFile): void {
  try {
    io.writeStoreText(JSON.stringify(next))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    io.rememberLog?.(`[okvevo-auth] failed to persist store: ${detail}`)
  }
}

export function persistOkvevoAuthPending(pending: OkvevoAuthPending | null, io: OkvevoAuthStoreIo): void {
  const file = readFile(io)

  if (pending) {
    file.pending = pending
  } else {
    delete file.pending
  }

  writeFile(io, file)
}

export function loadOkvevoAuthPending(io: OkvevoAuthStoreIo, now = Date.now()): OkvevoAuthPending | null {
  const pending = readFile(io).pending

  if (!pending || typeof pending.state !== 'string' || typeof pending.exp !== 'number') {
    return null
  }

  if (pending.exp < now) {
    return null
  }

  return pending
}

export function persistOkvevoAuthSession(session: OkvevoAuthSession | null, io: OkvevoAuthStoreIo): void {
  const file = readFile(io)

  delete file.pending

  if (!session) {
    delete file.secret
    writeFile(io, file)

    return
  }

  const secret = io.encrypt(JSON.stringify(session))

  if (!secret) {
    throw new Error('Secure token storage returned no encrypted payload; refusing to overwrite OkVevo auth.')
  }

  file.secret = secret
  writeFile(io, file)
}

export function loadOkvevoAuthSession(io: OkvevoAuthStoreIo): OkvevoAuthSession | null {
  const secret = readFile(io).secret

  if (!secret) {
    return null
  }

  try {
    const plaintext = io.decrypt(secret)

    if (!plaintext) {
      io.rememberLog?.('[okvevo-auth] failed to decrypt session; keeping stored entry for retry')

      return null
    }

    const parsed = JSON.parse(plaintext) as OkvevoAuthSession

    if (!parsed?.refreshToken || !parsed.idToken || !parsed.uid) {
      return null
    }

    return parsed
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    io.rememberLog?.(`[okvevo-auth] failed to load session: ${detail}`)

    return null
  }
}

export function rewriteOkvevoAuthSecret(
  shouldRewrite: (secret: unknown) => boolean,
  reencode: (secret: unknown) => unknown,
  io: OkvevoAuthStoreIo
): boolean {
  const file = readFile(io)

  if (!file.secret || !shouldRewrite(file.secret)) {
    return false
  }

  file.secret = reencode(file.secret) as StoredTokenSecret
  writeFile(io, file)

  return true
}
