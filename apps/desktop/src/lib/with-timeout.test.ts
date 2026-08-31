import { describe, expect, it, vi } from 'vitest'

import { shouldSuspendBackendBootWait, withSuspendableTimeout, withTimeout } from './with-timeout'

describe('shouldSuspendBackendBootWait', () => {
  it('is true during setup-choice, active install, and bootstrap.choice phase', () => {
    expect(shouldSuspendBackendBootWait({ bootstrapSetupChoice: { platform: 'win32', activeRoot: '/x' } })).toBe(
      true
    )
    expect(shouldSuspendBackendBootWait({ bootstrapActive: true })).toBe(true)
    expect(shouldSuspendBackendBootWait({ bootPhase: 'bootstrap.choice' })).toBe(true)
    expect(shouldSuspendBackendBootWait({})).toBe(false)
  })
})

describe('withSuspendableTimeout', () => {
  it('does not reject while suspended even after the budget elapses', async () => {
    vi.useFakeTimers()

    try {
      let settled = false

      void withSuspendableTimeout(new Promise<never>(() => undefined), 100, 'timed out', {
        isSuspended: () => true,
        pollMs: 50
      }).then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )

      await vi.advanceTimersByTimeAsync(500)
      expect(settled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects once the budget elapses outside suspended phases', async () => {
    vi.useFakeTimers()

    try {
      const result = withSuspendableTimeout(new Promise<never>(() => undefined), 100, 'timed out', {
        isSuspended: () => false,
        pollMs: 50
      })
      const assertion = expect(result).rejects.toThrow('timed out')

      await vi.advanceTimersByTimeAsync(150)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('withTimeout', () => {
  it('rejects with an onTimeout exception instead of letting it escape the timer callback', async () => {
    vi.useFakeTimers()

    try {
      const callbackFailure = new Error('abort callback failed')

      const result = withTimeout(new Promise<never>(() => undefined), 10, 'work timed out', () => {
        throw callbackFailure
      })

      const rejection = expect(result).rejects.toBe(callbackFailure)

      await vi.advanceTimersByTimeAsync(10)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})
