import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import { __resetBackendSkinSync } from './backend-sync'
import { modePref, skinPref, ThemeProvider, useTheme } from './context'
import { midnightTheme, okvevoTheme } from './presets'
import { requestMode, requestTheme } from './request'
import type { DesktopTheme } from './types'
import { THEMES_AREA } from './user-themes'

const cssVar = (name: string) => window.document.documentElement.style.getPropertyValue(name)

// OkVevo ships ONE locked dark theme. The imperative door still answers
// (resolvable names return true) but every drain re-asserts the lock, so no
// backend `/skin`, plugin event, or stored pref can repaint the app.
describe('requestTheme under the OkVevo theme lock', () => {
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

  it('leaves the OkVevo theme painted when a built-in switch is requested', () => {
    renderProbe()

    act(() => void requestTheme('mono'))

    expect(ctx.themeName).toBe('okvevo')
    expect(cssVar('--theme-foreground')).toBe(okvevoTheme.colors.foreground)
  })

  it('persisted picks still resolve to the locked skin', () => {
    renderProbe()

    act(() => void requestTheme('midnight'))

    expect(skinPref.resolve('default')).toBe('okvevo')
  })

  it('every requested mode resolves to dark', () => {
    renderProbe()

    act(() => requestMode('light'))

    expect(ctx.mode).toBe('dark')
    expect(modePref.resolve('default')).toBe('dark')
  })

  it('refuses a name that does not resolve', () => {
    renderProbe()

    let accepted = true
    act(() => {
      accepted = requestTheme('a-theme-nobody-installed')
    })

    expect(accepted).toBe(false)
    expect(ctx.themeName).toBe('okvevo')
  })

  it('does not activate a registry-contributed theme', () => {
    const zeus: DesktopTheme = { ...midnightTheme, description: 'Zeus', label: 'Zeus', name: 'zeus' }
    const dispose = registry.register({ area: THEMES_AREA, data: zeus, id: 'zeus' })

    renderProbe()

    act(() => void requestTheme('zeus'))

    expect(ctx.themeName).toBe('okvevo')
    expect(cssVar('--theme-foreground')).toBe(okvevoTheme.colors.foreground)

    dispose()
  })
})
