// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { AppearanceSettings } from './appearance-settings'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

function renderAppearance() {
  return render(
    <I18nProvider configClient={null}>
      <AppearanceSettings />
    </I18nProvider>
  )
}

describe('AppearanceSettings', () => {
  beforeEach(() => {
    isByokChromeVisible.mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows Language, density, tab strip, and Tool Call Display on internal', () => {
    renderAppearance()

    expect(screen.getByText('Language')).toBeTruthy()
    expect(screen.getByText('Session List Density')).toBeTruthy()
    expect(screen.getByText('Tab Strip')).toBeTruthy()
    expect(screen.getByText('Tool Call Display')).toBeTruthy()
    expect(screen.getByText('Desktop-only. Language, density, translucency, and chat chrome.')).toBeTruthy()
  })

  it('hides every Appearance control on public (section is nav-hidden via policy)', () => {
    isByokChromeVisible.mockReturnValue(false)
    renderAppearance()

    expect(screen.queryByText('Language')).toBeNull()
    expect(screen.queryByText('Session List Density')).toBeNull()
    expect(screen.queryByText('Tab Strip')).toBeNull()
    expect(screen.queryByText('Tool Call Display')).toBeNull()
    expect(screen.queryByText('Desktop-only. Language, density, translucency, and chat chrome.')).toBeNull()
    expect(screen.getByText('Appearance')).toBeTruthy()
  })
})
