import { describe, expect, it, vi } from 'vitest'

const isByokChromeVisibleMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible: isByokChromeVisibleMock
}))

import {
  categorizePublicError,
  friendlyErrorText,
  isKnownFriendlyError,
  PUBLIC_ERROR_COPY,
  publicErrorText,
  scrubUserFacingText
} from './user-facing-error'

describe('categorizePublicError', () => {
  it('maps every category by status code', () => {
    expect(categorizePublicError('HTTP 402: insufficient credits')).toBe('credits')
    expect(categorizePublicError('HTTP 429: too many requests')).toBe('rateLimit')
    expect(categorizePublicError('HTTP 401: unauthorized')).toBe('auth')
    expect(categorizePublicError('HTTP 403: forbidden')).toBe('auth')
    expect(categorizePublicError('HTTP 500: internal server error')).toBe('server')
    expect(categorizePublicError('HTTP 503: service unavailable')).toBe('server')
  })

  it('maps by marker text without a status code', () => {
    expect(categorizePublicError('Error: insufficient credits on account')).toBe('credits')
    expect(categorizePublicError('rate limit exceeded for this model')).toBe('rateLimit')
    expect(categorizePublicError('Blocked by safety system: violent content')).toBe('contentBlocked')
    expect(categorizePublicError('Connection error.')).toBe('network')
    expect(categorizePublicError('Temporary failure in name resolution')).toBe('network')
    expect(categorizePublicError('Read timeout.')).toBe('network')
  })

  it('returns null for unrecognized errors', () => {
    expect(categorizePublicError('KeyError: "session_id"')).toBeNull()
    expect(categorizePublicError('')).toBeNull()
  })

  it('recognizes its own copy as already-mapped', () => {
    for (const copy of Object.values(PUBLIC_ERROR_COPY)) {
      expect(categorizePublicError(copy)).not.toBeNull()
    }
  })
})

describe('friendlyErrorText (default-deny, no channel gate)', () => {
  it('maps recognized categories to the friendly copy', () => {
    expect(friendlyErrorText('HTTP 402: Payment required — https://nousresearch.com/portal')).toBe(
      PUBLIC_ERROR_COPY.credits
    )
    expect(friendlyErrorText('HTTP 500 from fal.ai queue')).toBe(PUBLIC_ERROR_COPY.server)
  })

  it('passes through known-friendly copy unchanged', () => {
    expect(friendlyErrorText(PUBLIC_ERROR_COPY.credits)).toBe(PUBLIC_ERROR_COPY.credits)
    expect(friendlyErrorText('Sign in to Nia to keep going.')).toBe('Sign in to Nia to keep going.')
  })

  it('default-denies anything unrecognized to the generic fallback', () => {
    expect(friendlyErrorText('KeyError: "session_id" in /opt/hermes/agent/loop.py')).toBe(PUBLIC_ERROR_COPY.fallback)
    expect(friendlyErrorText('')).toBe(PUBLIC_ERROR_COPY.fallback)
  })
})

describe('publicErrorText (channel-gated)', () => {
  it('maps on public builds', () => {
    isByokChromeVisibleMock.mockReturnValue(false)

    expect(publicErrorText('HTTP 429: rate limited')).toBe(PUBLIC_ERROR_COPY.rateLimit)
    expect(publicErrorText('TypeError: cannot read properties of undefined')).toBe(PUBLIC_ERROR_COPY.fallback)
  })

  it('passes raw text through on internal builds', () => {
    isByokChromeVisibleMock.mockReturnValue(true)

    expect(publicErrorText('HTTP 429: rate limited by OpenRouter')).toBe('HTTP 429: rate limited by OpenRouter')
  })
})

describe('scrubUserFacingText (brand scrub, no default-deny)', () => {
  it('rewrites vendor names but keeps the message on public builds', () => {
    isByokChromeVisibleMock.mockReturnValue(false)

    expect(scrubUserFacingText('Hermes gateway restarted')).toBe('Nia gateway restarted')
    expect(scrubUserFacingText('Grant spent · $12.00 top-up left')).toBe('Grant spent · $12.00 top-up left')
  })

  it('passes through unchanged on internal builds', () => {
    isByokChromeVisibleMock.mockReturnValue(true)

    expect(scrubUserFacingText('Hermes gateway restarted')).toBe('Hermes gateway restarted')
  })
})

describe('isKnownFriendlyError', () => {
  it('matches the canonical copies and friendly patterns', () => {
    expect(isKnownFriendlyError(PUBLIC_ERROR_COPY.fallback)).toBe(true)
    expect(isKnownFriendlyError('sign in to Nia first')).toBe(true)
    expect(isKnownFriendlyError('KeyError: "x"')).toBe(false)
  })
})
