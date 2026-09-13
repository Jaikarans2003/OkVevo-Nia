import { beforeEach, expect, test, vi } from 'vitest'

import { $notifications, clearNotifications, isDiskFullErrorMessage, notifyError, readableError } from './notifications'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

beforeEach(() => {
  isByokChromeVisible.mockReturnValue(true)
  clearNotifications()
})

function lastMessage(): string {
  return $notifications.get()[0]?.message ?? ''
}

// Regression for #39365: a gateway auth 401 (bad API_SERVER_KEY) must not be
// summarized as a provider (OpenAI/OpenRouter) API key problem.
test('gateway_auth_failed error is summarized as gateway auth, not provider key', () => {
  notifyError(
    new Error(
      '401 {"error": {"message": "Invalid gateway API key (API_SERVER_KEY)", "type": "gateway_auth_error", "code": "gateway_auth_failed"}}'
    ),
    'Request failed'
  )

  expect(lastMessage()).toContain('API_SERVER_KEY')
  expect(lastMessage()).not.toMatch(/OpenAI/i)
})

test('provider invalid_api_key error still maps to the OpenAI summary', () => {
  notifyError(
    new Error('401 {"error": {"message": "Incorrect API key provided", "code": "invalid_api_key"}}'),
    'Request failed'
  )

  expect(lastMessage()).toMatch(/OpenAI rejected the API key/i)
})

test('disk-full / ENOSPC errors toast a free-space message', () => {
  expect(isDiskFullErrorMessage('OSError: [Errno 28] No space left on device')).toBe(true)
  expect(isDiskFullErrorMessage('sqlite3.OperationalError: database or disk is full')).toBe(true)
  expect(isDiskFullErrorMessage('disk full: session storage could not be written — free some disk space')).toBe(true)
  expect(isDiskFullErrorMessage('This is often a full disk — free some space')).toBe(true)
  expect(isDiskFullErrorMessage('session storage could not be written: permission denied')).toBe(false)
  expect(isDiskFullErrorMessage('network timeout')).toBe(false)

  notifyError(new Error('OSError: [Errno 28] No space left on device: state.db'), 'Prompt failed')

  expect(lastMessage()).toMatch(/Disk full/i)
  expect(lastMessage()).toMatch(/free some space/i)
})

test('session storage write failure is treated as disk-full class', () => {
  notifyError(
    new Error('disk full: session storage could not be written — free some disk space and try again'),
    'Prompt failed'
  )

  expect(lastMessage()).toMatch(/Disk full/i)
})

test('public channel drops raw exception detail from readableError', () => {
  isByokChromeVisible.mockReturnValue(false)

  const readable = readableError(
    new Error("AttributeError: 'AIAgent' object has no attribute 'api_key'"),
    "Couldn't switch model"
  )

  expect(readable.message).toBe("Couldn't switch model")
  expect(readable.detail).toBeUndefined()

  notifyError(new Error("AttributeError: 'AIAgent' object has no attribute 'api_key'"), "Couldn't switch model")

  expect(lastMessage()).toBe("Couldn't switch model")
  expect($notifications.get()[0]?.detail).toBeUndefined()
})

test('internal channel keeps raw exception detail on readableError', () => {
  const raw = `${'Traceback (most recent call last): '.repeat(8)}AttributeError: 'AIAgent' object has no attribute 'api_key'`
  const readable = readableError(new Error(raw), "Couldn't switch model")

  expect(readable.message).toBe("Couldn't switch model")
  expect(readable.detail).toBe(raw)
})
