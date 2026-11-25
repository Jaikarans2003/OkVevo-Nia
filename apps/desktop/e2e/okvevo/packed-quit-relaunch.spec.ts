import * as fs from 'node:fs'
import * as path from 'node:path'

import { _electron, type ElectronApplication, expect, type Page, test } from '@playwright/test'

import {
  appLogTail,
  backendProcesses,
  coreAppEnv,
  createCoreSandbox,
  DESKTOP_ROOT,
  waitForInteractive
} from '../core/harness'

import { startGatewayMock } from './gateway-mock'

/**
 * Quit (or hard-kill) must not leave a host-lock that blocks the next boot with
 * exit 75. Covers: graceful quit → relaunch; and install-over / crash-style
 * leave-gateway-behind → relaunch takeover.
 */

const diagnostics = path.join(DESKTOP_ROOT, 'release', 'e2e-diagnostics')

function fakeJwt(exp: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ exp })}.e2e`
}

function resourcesDir(executable: string): string {
  const dir = path.dirname(executable)
  const mac = path.resolve(dir, '../Resources')

  if (fs.existsSync(path.join(mac, 'okvevo-pack-env.json'))) {
    return mac
  }

  const win = path.join(dir, 'resources')

  if (fs.existsSync(path.join(win, 'okvevo-pack-env.json'))) {
    return win
  }

  throw new Error(`okvevo-pack-env.json not beside ${executable}`)
}

function copyLogs(from: string, into: string) {
  const logs = path.join(from, 'logs')

  if (fs.existsSync(logs)) {
    fs.cpSync(logs, path.join(into, 'logs'), { recursive: true })
  }
}

function saveFailureEvidence(hermesHome: string, app: ElectronApplication | undefined) {
  fs.mkdirSync(diagnostics, { recursive: true })
  copyLogs(hermesHome, path.join(diagnostics, 'quit-relaunch-sandbox'))

  if (app) {
    fs.writeFileSync(path.join(diagnostics, 'quit-relaunch-electron-log-tail.txt'), appLogTail(app, 400))
  }
}

function seedAuthHome(hermesHome: string, token: string) {
  fs.writeFileSync(
    path.join(hermesHome, 'config.yaml'),
    'onboarding:\n  run: false\nnous:\n  guest: false\napprovals:\n  mode: "off"\n'
  )
  fs.writeFileSync(path.join(hermesHome, 'okvevo-firebase-id-token'), token, { mode: 0o600 })
  fs.writeFileSync(path.join(hermesHome, 'okvevo-firebase-refresh-token'), 'e2e-refresh', { mode: 0o600 })
}

async function launchPacked(
  executable: string,
  sandbox: ReturnType<typeof createCoreSandbox>
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = coreAppEnv(sandbox)
  delete env.HERMES_DESKTOP_HERMES_ROOT
  delete env.HERMES_DESKTOP_PYTHON

  const app = await _electron.launch({
    args: ['--disable-gpu', '--no-sandbox'],
    env,
    executablePath: executable,
    timeout: 120_000
  })

  const page = await app.firstWindow({ timeout: 120_000 })

  return { app, page }
}

test('packed app quits cleanly then starts again', async () => {
  test.skip(process.platform !== 'darwin', 'Mac pack E2E gate')
  const executable = process.env.OKVEVO_E2E_EXECUTABLE || ''

  if (!executable || !fs.existsSync(executable)) {
    throw new Error('OKVEVO_E2E_EXECUTABLE must be the packed OkVevo binary')
  }

  const now = Math.floor(Date.now() / 1000)
  const token = fakeJwt(now + 3600)
  fs.mkdirSync(diagnostics, { recursive: true })

  const mock = await startGatewayMock({
    freshIdToken: fakeJwt(now + 7200),
    logPath: path.join(diagnostics, 'quit-relaunch-mock.log')
  })

  const sandbox = createCoreSandbox('okvevo-quit-relaunch')
  const packPath = path.join(resourcesDir(executable), 'okvevo-pack-env.json')
  const originalPack = fs.readFileSync(packPath, 'utf8')
  const pack = JSON.parse(originalPack) as Record<string, unknown>
  pack.OKVEVO_WEB_ORIGIN = mock.origin
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`)
  seedAuthHome(sandbox.hermesHome, token)

  let app: ElectronApplication | undefined

  try {
    ;({ app } = await launchPacked(executable, sandbox))
    const page = await app.firstWindow({ timeout: 120_000 })
    await waitForInteractive(app, page)
    await expect.poll(() => backendProcesses(sandbox).length, { timeout: 60_000 }).toBeGreaterThan(0)

    await app.close()
    app = undefined

    await expect
      .poll(() => backendProcesses(sandbox).map(p => `${p.pid} ${p.cmdline.slice(0, 120)}`), {
        timeout: 60_000,
        message: 'graceful quit must stop the desktop-launched gateway'
      })
      .toEqual([])

    ;({ app } = await launchPacked(executable, sandbox))
    const page2 = await app.firstWindow({ timeout: 120_000 })
    await waitForInteractive(app, page2)
    const desktopLog = path.join(sandbox.hermesHome, 'logs', 'desktop.log')
    const logText = fs.existsSync(desktopLog) ? fs.readFileSync(desktopLog, 'utf8') : ''
    expect(logText).not.toMatch(/exited with status 75|runtime_exited/)
  } catch (error) {
    saveFailureEvidence(sandbox.hermesHome, app)
    throw error
  } finally {
    fs.writeFileSync(packPath, originalPack)

    if (app) {
      await app.close().catch(() => undefined)
    }

    mock.close()
    sandbox.cleanup()
  }
})

test('packed app starts after a prior copy left its gateway running', async () => {
  test.skip(process.platform !== 'darwin', 'Mac pack E2E gate')
  const executable = process.env.OKVEVO_E2E_EXECUTABLE || ''

  if (!executable || !fs.existsSync(executable)) {
    throw new Error('OKVEVO_E2E_EXECUTABLE must be the packed OkVevo binary')
  }

  const now = Math.floor(Date.now() / 1000)
  const token = fakeJwt(now + 3600)
  fs.mkdirSync(diagnostics, { recursive: true })

  const mock = await startGatewayMock({
    freshIdToken: fakeJwt(now + 7200),
    logPath: path.join(diagnostics, 'stale-takeover-mock.log')
  })

  const sandbox = createCoreSandbox('okvevo-stale-takeover')
  const packPath = path.join(resourcesDir(executable), 'okvevo-pack-env.json')
  const originalPack = fs.readFileSync(packPath, 'utf8')
  const pack = JSON.parse(originalPack) as Record<string, unknown>
  pack.OKVEVO_WEB_ORIGIN = mock.origin
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`)
  seedAuthHome(sandbox.hermesHome, token)

  let app: ElectronApplication | undefined

  try {
    ;({ app } = await launchPacked(executable, sandbox))
    const page = await app.firstWindow({ timeout: 120_000 })
    await waitForInteractive(app, page)
    await expect.poll(() => backendProcesses(sandbox).length, { timeout: 60_000 }).toBeGreaterThan(0)
    const before = backendProcesses(sandbox).map(p => p.pid)

    // Simulate install-over / force-quit: Electron dies, detached gateway stays.
    const electronPid = app.process().pid
    process.kill(electronPid, 'SIGKILL')
    app = undefined
    await expect
      .poll(() => backendProcesses(sandbox).some(p => before.includes(p.pid)), {
        timeout: 30_000,
        message: 'gateway must still be alive after Electron SIGKILL (precondition)'
      })
      .toBe(true)

    ;({ app } = await launchPacked(executable, sandbox))
    const page2 = await app.firstWindow({ timeout: 120_000 })
    await waitForInteractive(app, page2)
    const desktopLog = path.join(sandbox.hermesHome, 'logs', 'desktop.log')
    const logText = fs.existsSync(desktopLog) ? fs.readFileSync(desktopLog, 'utf8') : ''
    expect(logText).not.toMatch(/Gateway inaccessible \(runtime_exited\).*status 75/)
  } catch (error) {
    saveFailureEvidence(sandbox.hermesHome, app)
    throw error
  } finally {
    fs.writeFileSync(packPath, originalPack)

    if (app) {
      await app.close().catch(() => undefined)
    }

    mock.close()
    sandbox.cleanup()
  }
})
