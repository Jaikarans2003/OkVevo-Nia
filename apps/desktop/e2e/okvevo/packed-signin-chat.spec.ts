import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { appLogTail, backendProcesses, coreAppEnv, createCoreSandbox, DESKTOP_ROOT, send, waitForInteractive } from '../core/harness'

import { startGatewayMock } from './gateway-mock'

// PR 1.3: fresh install → sign in → first chat on the default bot must work on
// the SAME launch. No quit/reopen, no new bot. On the public (pre-fix) pack
// this fails: the running backend has no okvevo pool entry, so the first chat
// errors with "No usable credentials found for provider 'okvevo'".
//
// Requires the E2E pack variant (OKVEVO_E2E_AUTH=1 at build time) so the
// preload exposes e2eCompleteOkvevoSignIn; on the public pack the hook is
// dead-code-eliminated and this spec is skipped.

const shots = path.join(DESKTOP_ROOT, 'release', 'e2e-screenshots')
const diagnostics = path.join(DESKTOP_ROOT, 'release', 'e2e-diagnostics')

function fakeJwt(exp: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ exp })}.e2e`
}

function resourcesDir(executable: string): string {
  const dir = path.dirname(executable)
  const mac = path.resolve(dir, '../Resources')
  if (fs.existsSync(path.join(mac, 'okvevo-pack-env.json'))) return mac
  const win = path.join(dir, 'resources')
  if (fs.existsSync(path.join(win, 'okvevo-pack-env.json'))) return win
  throw new Error(`okvevo-pack-env.json not beside ${executable}`)
}

// Same marker the no-trace check (scripts/check-no-e2e-auth.mjs) greps, read
// the other way: a public pack has the hook stripped, so this spec must skip
// BEFORE it launches the app (launching just to skip leaves a backend to race
// the sandbox cleanup).
function packHasE2eAuthHook(executable: string): boolean {
  const dist = path.join(resourcesDir(executable), 'app.asar.unpacked', 'dist')
  try {
    return ['electron-main.mjs', 'electron-preload.js'].some(bundle =>
      fs.readFileSync(path.join(dist, bundle), 'utf8').includes('e2eCompleteOkvevoSignIn')
    )
  } catch {
    return false
  }
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, name) })
}

function copyLogs(from: string, into: string) {
  const logs = path.join(from, 'logs')
  if (fs.existsSync(logs)) fs.cpSync(logs, path.join(into, 'logs'), { recursive: true })
}

function saveFailureEvidence(hermesHome: string, app: ElectronApplication | undefined) {
  fs.mkdirSync(diagnostics, { recursive: true })
  copyLogs(hermesHome, path.join(diagnostics, 'signin-sandbox'))
  const userHome = path.join(os.homedir(), '.hermes')
  if (path.resolve(userHome) !== path.resolve(hermesHome)) copyLogs(userHome, path.join(diagnostics, 'signin-user-home'))
  if (app) fs.writeFileSync(path.join(diagnostics, 'signin-electron-log-tail.txt'), appLogTail(app, 400))
}

test('packed app signs in then chats on the default bot on one launch', async () => {
  const executable = process.env.OKVEVO_E2E_EXECUTABLE || ''
  if (!executable || !fs.existsSync(executable)) {
    throw new Error('OKVEVO_E2E_EXECUTABLE must be the packed OkVevo binary')
  }
  // Pre-launch skip: the public pack compiles the hook out; there is nothing
  // to test there (the no-trace check covers it) and no reason to boot an app.
  test.skip(!packHasE2eAuthHook(executable), 'public pack: e2e sign-in hook is compiled out (needs OKVEVO_E2E_AUTH=1 build)')

  const now = Math.floor(Date.now() / 1000)
  const token = fakeJwt(now + 3600)
  fs.mkdirSync(diagnostics, { recursive: true })
  const mock = await startGatewayMock({
    exchangeIdToken: token,
    logPath: path.join(diagnostics, 'signin-mock-requests.log')
  })
  const sandbox = createCoreSandbox('okvevo-signin')
  const packPath = path.join(resourcesDir(executable), 'okvevo-pack-env.json')
  const originalPack = fs.readFileSync(packPath, 'utf8')
  const pack = JSON.parse(originalPack) as Record<string, unknown>
  pack.OKVEVO_WEB_ORIGIN = mock.origin
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`)
  fs.writeFileSync(
    path.join(sandbox.hermesHome, 'config.yaml'),
    'onboarding:\n  run: false\nnous:\n  guest: false\napprovals:\n  mode: "off"\n'
  )
  // Fresh install: no okvevo-firebase-id-token / refresh-token seeded.

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
  let failed = false

  try {
    // Reproduce the real fresh-install ordering: the backend must be fully up
    // (gateway serving, plugins registered while signed out) BEFORE sign-in.
    // Signing in earlier masks the bug — the backend's own plugin load would
    // write the pool row and the first chat would pass without the fix.
    // gateway.lock is written when the gateway serves; plugin register
    // (okvevo) happens before that in the same process.
    await expect
      .poll(
        () => {
          try {
            const lock = JSON.parse(fs.readFileSync(path.join(sandbox.hermesHome, 'gateway.lock'), 'utf8')) as {
              pid?: unknown
            }
            return Number.isInteger(lock?.pid) && backendProcesses(sandbox).length > 0
          } catch {
            return false
          }
        },
        { timeout: 180_000, intervals: [500] }
      )
      .toBe(true)

    // Sign in: drive the real deep-link callback path against the mock. This is
    // the moment the bug hits — the running backend gets its okvevo pool entry
    // here (or fails to, pre-fix). _finishOkvevoAuthCallback swallows exchange
    // errors into a dialog, so the IPC return is not proof — poll the real
    // auth snapshot and the mock exchange counter instead.
    const signedIn = await page.evaluate(async () => {
      const desktop = (window as unknown as {
        hermesDesktop: { e2eCompleteOkvevoSignIn: (code: string, state: string) => Promise<{ ok: boolean; error?: string }> }
      }).hermesDesktop
      return desktop.e2eCompleteOkvevoSignIn('e2e-code', 'e2e-state')
    })
    expect(signedIn.ok, `sign-in failed: ${signedIn.error ?? 'unknown'}`).toBe(true)
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as {
              hermesDesktop: { getOkvevoAuth: () => Promise<{ signedIn: boolean }> }
            }).hermesDesktop.getOkvevoAuth().then(snap => snap.signedIn)
          ),
        { timeout: 30_000 }
      )
      .toBe(true)
    expect(mock.exchanges).toBeGreaterThan(0)

    // The fix's core invariant: sign-in writes the okvevo pool row for the
    // RUNNING backend on this same launch (the desktop spawns the
    // `okvevo-ensure-credentials` CLI sync in the background — wait for it).
    // The row is file-backed: it witnesses credential resolution and must
    // never contain the JWT itself.
    const authJsonPath = path.join(sandbox.hermesHome, 'auth.json')
    let rowReady = false
    try {
      await expect
        .poll(
          () => {
            try {
              const text = fs.readFileSync(authJsonPath, 'utf8')
              return text.includes('manual:okvevo-desktop') && text.includes('okvevo-file')
            } catch {
              return false
            }
          },
          { timeout: 60_000 }
        )
        .toBe(true)
      rowReady = true
    } catch {
      rowReady = false
    }
    if (!rowReady) {
      // Surface the user-facing symptom in the failure message: bring the app
      // up, send the first chat anyway, and quote what the user would see
      // (pre-fix that is "No usable credentials found for provider 'okvevo'").
      await waitForInteractive(app, page).catch(() => undefined)
      await send(page, 'ping after sign in').catch(() => undefined)
      const credentialError = await page
        .getByText('No usable credentials found')
        .first()
        .isVisible({ timeout: 60_000 })
        .catch(() => false)
      await shot(page, 'signin-no-pool-row.png')
      throw new Error(
        'sign-in did not write the okvevo pool row for the running backend on this launch' +
          ' (PR 1.3 fresh-install bug). First chat shows' +
          ` "No usable credentials found for provider 'okvevo'": ${credentialError ? 'YES' : 'no — see screenshot + diagnostics'}`
      )
    }
    expect(fs.readFileSync(authJsonPath, 'utf8')).not.toContain(token)

    // Now the app should become interactive (composer visible) on this launch.
    await waitForInteractive(app, page)
    await shot(page, 'signin-after-callback.png')

    // First chat on the default bot, no restart, no new bot. Pre-fix this
    // errors with "No usable credentials found for provider 'okvevo'".
    await send(page, 'ping after sign in')
    await expect(page.getByText('E2E_REPLY ok').first()).toBeVisible({ timeout: 120_000 })
    const call = mock.calls.find(c => JSON.stringify(c.messages ?? []).includes('ping after sign in'))
    expect(call, 'no gateway call carried the first-chat message').toBeTruthy()
    expect(call!.authorization || '').toContain(token)
    await expect(page.getByText('No usable credentials found')).toHaveCount(0)
    await shot(page, 'signin-first-chat.png')
  } catch (error) {
    failed = true
    throw error
  } finally {
    if (failed) saveFailureEvidence(sandbox.hermesHome, app)
    await app.close().catch(() => undefined)
    fs.writeFileSync(packPath, originalPack)
    await mock.close()
    sandbox.cleanup()
  }
})
