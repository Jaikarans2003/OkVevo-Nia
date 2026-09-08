// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useComposerPlaceholder } from './use-composer-placeholder'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      composer: {
        placeholderStarting: 'Starting…',
        placeholderReconnecting: 'Reconnecting…',
        newSessionPlaceholders: ['Alpha', 'Beta'],
        followUpPlaceholders: ['Follow']
      }
    }
  })
}))

vi.mock('@/store/composer-input-history', () => ({
  resetBrowseState: vi.fn()
}))

afterEach(() => {
  vi.useRealTimers()
})

describe('useComposerPlaceholder loop', () => {
  it('types forward then deletes through the pool when looping', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useComposerPlaceholder({
        disabled: false,
        loop: true,
        reconnecting: false,
        sessionId: null
      })
    )

    expect(result.current.looping).toBe(true)

    act(() => {
      vi.advanceTimersByTime(28 * 5)
    })
    expect(result.current.text).toBe('Alpha')

    act(() => {
      vi.advanceTimersByTime(1100 + 28 * 5 + 50)
    })
    expect(result.current.text).toBe('')
  })

  it('stays static when loop is off (HUD)', () => {
    const { result } = renderHook(() =>
      useComposerPlaceholder({
        disabled: false,
        loop: false,
        reconnecting: false,
        sessionId: null
      })
    )

    expect(result.current.looping).toBe(false)
    expect(['Alpha', 'Beta']).toContain(result.current.text)
  })
})
