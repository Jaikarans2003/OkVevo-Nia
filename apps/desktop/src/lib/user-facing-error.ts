/**
 * Public-build error privacy net (Nia).
 *
 * The display-side half of agent/user_facing_errors.py — keep the two copy
 * decks in sync. Every error surface (chat error bubble, toast, native
 * notification, tool row) routes through here on public builds:
 * recognized categories get the friendly OkVevo copy, anything unrecognized
 * gets the generic fallback. Default-deny is the point: a tool or provider
 * added tomorrow is automatically covered.
 *
 * Internal builds (BYOK chrome visible) keep raw text everywhere.
 */

import { isByokChromeVisible } from '@/lib/build-channel'
import { sanitizeUserFacingBrand } from '@/lib/display-path'

export const PUBLIC_ERROR_COPY = {
  credits:
    "You're out of OkVevo credits — top up at okvevo.com and I'll pick up right where we left off.",
  rateLimit: 'Whoa, slow down — too many requests at once. Give it a few seconds and try again.',
  server: "Something broke on our side. The OkVevo team is on it — try again in a bit.",
  auth: 'Your session hit a snag — restart Nia and we should be good.',
  network: "Can't reach OkVevo right now — check your internet and try again.",
  contentBlocked: 'That one got blocked by content filters — try rephrasing.',
  unreadableFile: "I couldn't read that file — try attaching it again.",
  fallback: 'Something went wrong on my end — give that another try.'
} as const

export type PublicErrorCategory = keyof typeof PUBLIC_ERROR_COPY

const KNOWN_FRIENDLY: ReadonlySet<string> = new Set(Object.values(PUBLIC_ERROR_COPY))

/**
 * Friendly copy the Python side emits unmapped (sign-in prompts, availability
 * messages). Default-deny must recognize its own voice or it would genericize
 * the most actionable errors we have.
 * ponytail: allowlist of exact patterns; new friendly copy belongs here.
 */
const FRIENDLY_PATTERNS: RegExp[] = [/^sign in to nia\b/i, /contact okvevo support\.?$/i]

const HTTP_STATUS_RE = /\bHTTP\s{0,2}(\d{3})\b/i

const NETWORK_MARKERS = [
  'temporary failure in name resolution',
  'name or service not known',
  'nodename nor servname provided, or not known',
  'getaddrinfo failed',
  'no address associated with hostname',
  'network is unreachable',
  'may be offline',
  'connection error',
  'connection refused',
  'connection reset',
  'connect timeout',
  'read timeout',
  'timed out',
  'dns'
]

function extractStatus(raw: string): number | null {
  const match = HTTP_STATUS_RE.exec(raw)

  return match ? Number.parseInt(match[1], 10) : null
}

/** Category for an error string, or null when unrecognized. Never vendor-name matching. */
export function categorizePublicError(raw: string): PublicErrorCategory | null {
  const text = raw.trim()

  if (!text) {
    return null
  }

  for (const [category, copy] of Object.entries(PUBLIC_ERROR_COPY)) {
    if (text === copy) {
      return category as PublicErrorCategory
    }
  }

  const lowered = text.toLowerCase()
  const status = extractStatus(text)

  if (
    status === 402 ||
    lowered.includes('insufficient credits') ||
    lowered.includes('out of credits') ||
    lowered.includes('payment required') ||
    lowered.includes('okvevo credits')
  ) {
    return 'credits'
  }

  if (status === 429 || lowered.includes('rate limit') || lowered.includes('too many requests')) {
    return 'rateLimit'
  }

  if (status === 401 || status === 403) {
    return 'auth'
  }

  if (status !== null && status >= 500 && status < 600) {
    return 'server'
  }

  if (
    lowered.includes('content filter') ||
    lowered.includes('content policy') ||
    lowered.includes('blocked by safety') ||
    lowered.includes('safety system')
  ) {
    return 'contentBlocked'
  }

  if (NETWORK_MARKERS.some(marker => lowered.includes(marker))) {
    return 'network'
  }

  return null
}

/** True when the text is already our friendly copy (mapped or hand-written). */
export function isKnownFriendlyError(raw: string): boolean {
  const text = raw.trim()

  return KNOWN_FRIENDLY.has(text) || FRIENDLY_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Default-deny mapping, no channel gate: recognized → category copy,
 * recognized-friendly → passthrough, anything else → generic fallback.
 * Product-mode surfaces use this directly; channel-gated surfaces use
 * `publicErrorText`.
 */
export function friendlyErrorText(raw: string): string {
  const text = raw.trim()

  if (!text) {
    return PUBLIC_ERROR_COPY.fallback
  }

  if (isKnownFriendlyError(text)) {
    return text
  }

  const category = categorizePublicError(text)

  return category ? PUBLIC_ERROR_COPY[category] : PUBLIC_ERROR_COPY.fallback
}

/**
 * Channel-gated default-deny for error/notice/approval surfaces on public
 * builds. Internal builds return the input unchanged. Never applied to
 * assistant prose — a user asking "what is fal.ai?" must get a real answer.
 */
export function publicErrorText(raw: string): string {
  if (isByokChromeVisible()) {
    return raw
  }

  return friendlyErrorText(raw)
}

/**
 * Brand scrub WITHOUT the default-deny fallback, for surfaces whose text is
 * curated copy rather than raw exceptions (agent notices, approval
 * descriptions): rewrite leftover vendor names, keep the message. Public
 * builds only; internal returns the input unchanged.
 */
export function scrubUserFacingText(raw: string): string {
  if (isByokChromeVisible()) {
    return raw
  }

  return sanitizeUserFacingBrand(raw)
}
