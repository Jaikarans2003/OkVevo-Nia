import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { DesktopUpdateStatus } from '@/global'
import { I18nProvider } from '@/i18n/context'
import {
  $updateApply,
  $updateOverlayOpen,
  $updateOverlayTarget,
  $updateStatus,
  resetUpdateApplyState
} from '@/store/updates'

import { BlockerView, formatBlockerCommandLine, UpdatesOverlay } from './updates-overlay'

async function renderWithI18n(ui: React.ReactNode) {
  await act(async () => {
    render(
      <I18nProvider configClient={{ getConfig: async () => ({}), saveConfig: async () => ({ ok: true }) }}>
        <Dialog open>
          <DialogContent>{ui}</DialogContent>
        </Dialog>
      </I18nProvider>
    )
  })
}

async function renderUpdatesOverlay() {
  await act(async () => {
    render(
      <I18nProvider configClient={{ getConfig: async () => ({}), saveConfig: async () => ({ ok: true }) }}>
        <UpdatesOverlay />
      </I18nProvider>
    )
  })
}

describe('formatBlockerCommandLine', () => {
  it('redacts the full ambiguous tail after a sensitive CLI, environment, or header marker', () => {
    const secretParts = ['first-part', 'second-part']
    const secret = secretParts.join(' ')

    const commands = [
      `python.exe watcher.py --token ${secret} --mode inspect`,
      ['python.exe watcher.py --password="', secret, '" --mode inspect'].join(''),
      `AUTH_TOKEN=${secret} python.exe watcher.py --mode inspect`,
      `python.exe watcher.py Authorization: Bearer ${secret} --mode inspect`
    ]

    for (const commandLine of commands) {
      const formatted = formatBlockerCommandLine(commandLine)

      expect(formatted).not.toContain(secretParts[0])
      expect(formatted).not.toContain(secretParts[1])
      expect(formatted).not.toContain('--mode inspect')
      expect(formatted.endsWith('[REDACTED]')).toBe(true)
    }
  })

  it('redacts a sensitive query value and bounds the remaining diagnostic output', () => {
    const queryValue = ['private', 'value'].join('-')

    const commandLine =
      `python.exe watcher.py https://example.test/?api_key=${queryValue}&mode=inspect ` + 'x'.repeat(600)

    const formatted = formatBlockerCommandLine(commandLine)

    expect(formatted).not.toContain(queryValue)
    expect(formatted).toContain('api_key=[REDACTED]&mode=inspect')
    expect(Array.from(formatted).length).toBeLessThanOrEqual(500)
    expect(formatted.endsWith('…')).toBe(true)
  })
})

describe('BlockerView', () => {
  afterEach(() => {
    cleanup()
    $updateOverlayOpen.set(false)
    $updateOverlayTarget.set('client')
    $updateStatus.set(null)
    resetUpdateApplyState()
  })

  it('uses the blocker view for a foreign process instead of the generic update error', async () => {
    $updateOverlayTarget.set('client')
    $updateOverlayOpen.set(true)
    $updateStatus.set({
      supported: true,
      updateAvailable: true,
      behind: 1,
      commits: []
    } as DesktopUpdateStatus)
    $updateApply.set({
      applying: false,
      stage: 'error',
      message: 'Update aborted: another Hermes process is using this installation.',
      percent: null,
      error: 'venv-blocked',
      command: null,
      blockers: [
        {
          pid: 58636,
          name: 'python.exe',
          cmdline: 'python.exe fenbi_session_refresh.py',
          kind: 'other',
          safeToStop: false
        }
      ],
      log: []
    })

    await renderUpdatesOverlay()

    expect(screen.getByText('Close other processes to update Nia')).toBeTruthy()
    expect(screen.getByText('python.exe')).toBeTruthy()
    expect(screen.queryByText('Update didn’t finish')).toBeNull()
  })

  it('identifies foreign blockers without offering automatic termination', async () => {
    const onStopAndUpdate = vi.fn()

    await renderWithI18n(
      <BlockerView
        blockers={[
          {
            pid: 58636,
            name: 'python.exe',
            cmdline: 'python.exe fenbi_session_refresh.py',
            kind: 'other',
            safeToStop: false
          }
        ]}
        onDismiss={() => {}}
        onStopAndUpdate={onStopAndUpdate}
      />
    )

    expect(screen.getByText('Close other processes to update Nia')).toBeTruthy()
    expect(screen.getByText('python.exe')).toBeTruthy()
    expect(screen.getByText('PID 58636')).toBeTruthy()
    expect(screen.getByText(/can’t safely close these processes automatically/i)).toBeTruthy()
    expect(screen.getByText(/python.exe fenbi_session_refresh\.py/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /close previews/i })).toBeNull()
    expect(onStopAndUpdate).not.toHaveBeenCalled()
  })

  it('keeps mixed blocker cleanup limited to safe previews', async () => {
    const onStopAndUpdate = vi.fn()

    await renderWithI18n(
      <BlockerView
        blockers={[
          {
            pid: 47484,
            name: 'python.exe',
            cmdline: 'python.exe -m http.server 8766',
            kind: 'local-preview',
            safeToStop: true,
            label: 'Example Preview',
            port: 8766
          },
          {
            pid: 58636,
            name: 'python.exe',
            cmdline: 'python.exe fenbi_session_refresh.py',
            kind: 'other',
            safeToStop: false
          }
        ]}
        onDismiss={() => {}}
        onStopAndUpdate={onStopAndUpdate}
      />
    )

    expect(screen.getByText(/can close the local previews listed below/i)).toBeTruthy()
    expect(screen.getByText('Example Preview')).toBeTruthy()
    expect(screen.getByText('python.exe')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close previews and check again' }))
    expect(onStopAndUpdate).toHaveBeenCalledTimes(1)
  })

  it('explains safe local previews and offers one-click close-and-update', async () => {
    const onStopAndUpdate = vi.fn()

    await renderWithI18n(
      <BlockerView
        blockers={[
          {
            pid: 47484,
            name: 'python.exe',
            cmdline: 'python.exe -m http.server 8766',
            kind: 'local-preview',
            safeToStop: true,
            label: 'Example Preview',
            port: 8766
          }
        ]}
        onDismiss={() => {}}
        onStopAndUpdate={onStopAndUpdate}
      />
    )

    expect(screen.getByText('Close local previews to update Nia?')).toBeTruthy()
    expect(screen.getByText('Example Preview')).toBeTruthy()
    expect(screen.getByText('Port 8766')).toBeTruthy()
    expect(screen.getByText(/will not modify or delete your files/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close previews and update' }))
    expect(onStopAndUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('ErrorView', () => {
  const openExternal = vi.fn()

  afterEach(() => {
    cleanup()
    $updateOverlayOpen.set(false)
    $updateOverlayTarget.set('client')
    $updateStatus.set(null)
    resetUpdateApplyState()
    delete (globalThis as unknown as { window?: { hermesDesktop?: unknown } }).window.hermesDesktop
  })

  function seedError(error: string, message: string) {
    $updateOverlayTarget.set('client')
    $updateOverlayOpen.set(true)
    $updateStatus.set({
      supported: true,
      updateAvailable: true,
      behind: 1,
      commits: []
    } as DesktopUpdateStatus)
    $updateApply.set({
      applying: false,
      stage: 'error',
      message,
      percent: null,
      error,
      command: null,
      log: []
    })
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { openExternal }
    })
  }

  it('UPD-SIGNATURE shows Download latest, branded copy, and none of the raw internals', async () => {
    openExternal.mockReset()
    seedError(
      'UPD-SIGNATURE',
      String.raw`New version 0.17.14 is not signed by the application owner: publisherNames: OkVevo, raw info: {
  "Path": "C:\\Users\\karan\\AppData\\Local\\hermes-updater\\pending\\temp-Nia-0.17.14-win-x64.exe",
  "StatusMessage": "PowerShell Execution_Policies"
}`
    )

    await renderUpdatesOverlay()

    const body = screen.getByText(/Nia couldn't finish updating/i)

    expect(body.textContent).toMatch(/Nia/)
    expect(body.textContent).toMatch(/UPD-SIGNATURE/)
    expect(body.textContent).not.toMatch(/hermes/i)
    expect(body.textContent).not.toMatch(/PowerShell/)
    expect(body.textContent).not.toMatch(/publisherNames/)
    expect(body.textContent).not.toMatch(/Execution_Policies/)
    expect(body.textContent).not.toMatch(/karan/)
    expect(body.textContent).not.toMatch(/C:\\Users/)
    expect(screen.getByRole('button', { name: 'Download latest' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Download latest' }))
    expect(openExternal).toHaveBeenCalledWith('https://www.okvevo.com')
  })

  it('UPD-DOWNLOAD shows Try again', async () => {
    seedError('UPD-DOWNLOAD', 'net::ERR_CONNECTION_RESET')

    await renderUpdatesOverlay()

    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download latest' })).toBeNull()
    expect(screen.getByText(/UPD-DOWNLOAD/)).toBeTruthy()
    expect(screen.queryByText(/net::ERR_CONNECTION_RESET/)).toBeNull()
  })
})
