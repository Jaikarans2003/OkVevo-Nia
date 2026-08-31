import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { __resetBackendSkinSync, ingestBackendSkin } from './backend-sync'
import { ThemeProvider } from './context'
import { niaTheme } from './presets'

const bloomberg = (foreground: string) => ({
  name: 'bloomberg',
  colors: { background: '#000000', ui_text: foreground, ui_accent: '#ff8000' }
})

const cssVar = (name: string) => window.document.documentElement.style.getPropertyValue(name)

describe('ThemeProvider paints the fixed Nia theme', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetBackendSkinSync()
  })

  afterEach(cleanup)

  it('applies charcoal / sand on mount', () => {
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    )

    expect(cssVar('--theme-foreground')).toBe(niaTheme.colors.foreground)
    expect(cssVar('--theme-background-seed')).toBe(niaTheme.colors.background)
  })

  it('does not paint a backend skin apply (picker and drain are gone)', () => {
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    )

    act(() => ingestBackendSkin(bloomberg('#ff9f0a'), { apply: true }))

    expect(cssVar('--theme-foreground')).toBe(niaTheme.colors.foreground)
    expect(cssVar('--theme-background-seed')).toBe(niaTheme.colors.background)
  })

  it('does not repaint an in-place edit of a backend skin', () => {
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    )

    act(() => ingestBackendSkin(bloomberg('#ff9f0a'), { apply: true }))
    act(() => ingestBackendSkin(bloomberg('#ff2d95'), { apply: true }))

    expect(cssVar('--theme-foreground')).toBe(niaTheme.colors.foreground)
  })
})
