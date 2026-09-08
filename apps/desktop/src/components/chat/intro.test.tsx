// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $okvevoAuth } from '@/store/okvevo-auth'

import { Intro, resolveIntroSubtitle, resolveSplashUserName } from './intro'

afterEach(() => {
  cleanup()
  $okvevoAuth.set({ signedIn: false, uid: null, email: null, displayName: null })
  vi.useRealTimers()
})

describe('resolveSplashUserName', () => {
  it('uses OkVevo displayName, else email, never a hardcoded person', () => {
    expect(resolveSplashUserName({ displayName: 'Karan', email: 'a@b.c' })).toBe('Karan')
    expect(resolveSplashUserName({ displayName: '  ', email: 'a@b.c' })).toBe('a@b.c')
    expect(resolveSplashUserName({ displayName: null, email: null })).toBe('')
  })
})

describe('resolveIntroSubtitle', () => {
  it('returns a non-empty body line for the composer underside', () => {
    expect(resolveIntroSubtitle(undefined, 0).length).toBeGreaterThan(10)
  })
})

describe('Intro splash mark', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('stacks a brief greeting under the GIF', () => {
    $okvevoAuth.set({ signedIn: true, uid: 'u1', email: 'a@b.c', displayName: 'Karan' })

    const { container } = render(<Intro seed={0} />)
    const img = container.querySelector('img')
    const root = container.querySelector('[data-slot="aui_intro"]')

    expect(img?.getAttribute('src')).toMatch(/nia-intro\.gif$/)
    expect(root?.className).toMatch(/flex-col/)
    expect(container.querySelector('[data-slot="aui_intro"]')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(45 * 80)
    })

    expect(container.textContent).toContain('Karan')
    expect(container.textContent).toContain("I'm Nia.")
    expect(container.textContent).not.toMatch(/creating/i)
    const orange = [...container.querySelectorAll('.intro-splash-name')].map(n => n.textContent)
    expect(orange).toEqual(['Karan', 'Nia'])
  })
})
