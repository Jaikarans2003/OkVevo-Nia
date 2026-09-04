// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'

import { SYSTEM_TOOL_COUNT } from './titlebar'
import { TitlebarControls } from './titlebar-controls'

afterEach(cleanup)

function mount() {
  return render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <TitlebarControls onOpenSettings={() => {}} />
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('TitlebarControls', () => {
  it('hides layout and right-sidebar tools; system cluster matches SYSTEM_TOOL_COUNT', () => {
    mount()

    expect(screen.queryByRole('button', { name: 'Layout editor' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide right sidebar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show right sidebar' })).toBeNull()

    const cluster = screen.getByLabelText('App controls')
    const buttons = within(cluster).getAllByRole('button')

    expect(buttons).toHaveLength(SYSTEM_TOOL_COUNT)
    expect(within(cluster).getByRole('button', { name: 'HUD mode' })).toBeTruthy()
    expect(within(cluster).getByRole('button', { name: 'Mute haptics' })).toBeTruthy()
    expect(within(cluster).getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(within(cluster).getByRole('button', { name: 'Open settings' })).toBeTruthy()
  })
})
