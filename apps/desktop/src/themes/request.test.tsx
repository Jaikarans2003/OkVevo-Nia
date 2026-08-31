import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import { __resetBackendSkinSync } from './backend-sync'
import { ThemeProvider, useTheme } from './context'
import { niaTheme } from './presets'
import { requestTheme } from './request'
import type { DesktopTheme } from './types'
import { THEMES_AREA } from './user-themes'

const cssVar = (name: string) => window.document.documentElement.style.getPropertyValue(name)

describe('requestTheme', () => {
  let ctx: ReturnType<typeof useTheme>

  function Probe() {
    ctx = useTheme()

    return null
  }

  const renderProbe = () =>
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )

  beforeEach(() => {
    window.localStorage.clear()
    __resetBackendSkinSync()
  })

  afterEach(cleanup)

  it('refuses every switch and leaves the Nia theme painted', () => {
    renderProbe()

    let accepted = true
    act(() => {
      accepted = requestTheme('nia')
    })

    expect(accepted).toBe(false)
    expect(ctx.themeName).toBe('nia')
    expect(cssVar('--theme-foreground')).toBe(niaTheme.colors.foreground)
  })

  it('refuses an unknown name', () => {
    renderProbe()

    let accepted = true
    act(() => {
      accepted = requestTheme('a-theme-nobody-installed')
    })

    expect(accepted).toBe(false)
    expect(cssVar('--theme-foreground')).toBe(niaTheme.colors.foreground)
  })

  it('does not activate a registry-contributed theme', () => {
    const zeus: DesktopTheme = { ...niaTheme, description: 'Zeus', label: 'Zeus', name: 'zeus' }
    const dispose = registry.register({ area: THEMES_AREA, data: zeus, id: 'zeus' })

    renderProbe()

    let accepted = true
    act(() => {
      accepted = requestTheme('zeus')
    })

    expect(accepted).toBe(false)
    expect(ctx.themeName).toBe('nia')

    dispose()
  })
})
