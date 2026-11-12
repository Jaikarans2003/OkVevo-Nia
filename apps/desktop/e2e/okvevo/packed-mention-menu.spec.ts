import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { _electron, type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { appLogTail, backendProcesses, coreAppEnv, createCoreSandbox, DESKTOP_ROOT, waitForInteractive } from '../core/harness'

import { startGatewayMock } from './gateway-mock'

/**
 * Packed `@` menu must show one `@okvevo — OkVevo agent` row and never the
 * gateway twins `@hermes` / `@default` / `agent profile (primary)`.
 *
 * Prior false pass: packed-chat / packed-signin never opened the listbox.
 * Requires the E2E pack variant (OKVEVO_E2E_AUTH=1) like packed-signin-chat.
 */

const shots = path.join(DESKTOP_ROOT, 'release', 'e2e-screenshots')
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

function composer(page: Page) {
  return page.locator('[data-slot="composer-root"] [contenteditable="true"]').filter({ visible: true }).first()
}

async function openMentionMenu(page: Page) {
  const box = composer(page)
  await box.click()
  await box.press('ControlOrMeta+a')
  await box.press('Backspace')
  await box.pressSequentially('@', { delay: 20 })
  await expect(page.getByRole('listbox')).toBeVisible({ timeout: 30_000 })
}

async function expectOkvevoMentionMenu(page: Page, label: string) {
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const text = await listbox.innerText()

  expect(text, `${label}: missing @okvevo`).toMatch(/@okvevo/)
  expect(text, `${label}: missing OkVevo agent`).toMatch(/OkVevo agent/)
  expect(text, `${label}: gateway @hermes leaked`).not.toMatch(/@hermes\b/)
  expect(text, `${label}: gateway @default leaked`).not.toMatch(/@default\b/)
  expect(text, `${label}: agent profile (primary) leaked`).not.toMatch(/agent profile \(primary\)/)

  const okvevoRows = listbox.getByRole('button').filter({ hasText: /@okvevo/ })
  await expect(okvevoRows, `${label}: exactly one @okvevo row`).toHaveCount(1)
  await expect(okvevoRows.first()).toContainText('OkVevo agent')
}

async function openBots(page: Page) {
  await page.getByRole('button', { name: 'Bots', exact: true }).or(page.getByRole('tab', { name: 'Bots', exact: true })).first().click()
  await expect(page.getByRole('button', { name: 'New bot or group chat' })).toBeVisible()
}

async function createBot(page: Page, name: string, title: string) {
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: 'New Bot' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Bot' })
  await dialog.getByPlaceholder('inbox-triage').fill(name)
  await dialog.getByPlaceholder('Inbox Triage').fill(title)
  await dialog.getByRole('button', { name: 'Create Bot' }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: new RegExp(`^${title}\\b`) }).first()).toBeVisible({ timeout: 60_000 })
}

function copyLogs(from: string, into: string) {
  const logs = path.join(from, 'logs')

  if (fs.existsSync(logs)) {
    fs.cpSync(logs, path.join(into, 'logs'), { recursive: true })
  }
}

function saveFailureEvidence(hermesHome: string, app: ElectronApplication | undefined) {
  fs.mkdirSync(diagnostics, { recursive: true })
  copyLogs(hermesHome, path.join(diagnostics, 'mention-sandbox'))
  const userHome = path.join(os.homedir(), '.hermes')

  if (path.resolve(userHome) !== path.resolve(hermesHome)) {
    copyLogs(userHome, path.join(diagnostics, 'mention-user-home'))
  }

  if (app) {
    fs.writeFileSync(path.join(diagnostics, 'mention-electron-log-tail.txt'), appLogTail(app, 400))
  }
}

test('packed @ menu shows @okvevo in normal session and bot chat', async () => {
  test.setTimeout(900_000)
  const executable = process.env.OKVEVO_E2E_EXECUTABLE || ''

  if (!executable || !fs.existsSync(executable)) {
    throw new Error('OKVEVO_E2E_EXECUTABLE must be the packed OkVevo binary')
  }

  test.skip(!packHasE2eAuthHook(executable), 'public pack: e2e sign-in hook is compiled out (needs OKVEVO_E2E_AUTH=1 build)')

  const now = Math.floor(Date.now() / 1000)
  const token = fakeJwt(now + 3600)
  fs.mkdirSync(diagnostics, { recursive: true })

  const mock = await startGatewayMock({
    exchangeIdToken: token,
    logPath: path.join(diagnostics, 'mention-mock-requests.log')
  })

  const sandbox = createCoreSandbox('okvevo-mention')
  const packPath = path.join(resourcesDir(executable), 'okvevo-pack-env.json')
  const originalPack = fs.readFileSync(packPath, 'utf8')
  const pack = JSON.parse(originalPack) as Record<string, unknown>
  pack.OKVEVO_WEB_ORIGIN = mock.origin
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`)
  fs.writeFileSync(
    path.join(sandbox.hermesHome, 'config.yaml'),
    'onboarding:\n  run: false\nnous:\n  guest: false\napprovals:\n  mode: "off"\n'
  )

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

    const signedIn = await page.evaluate(async () => {
      const desktop = (
        window as unknown as {
          hermesDesktop: {
            e2eCompleteOkvevoSignIn: (code: string, state: string) => Promise<{ ok: boolean; error?: string }>
          }
        }
      ).hermesDesktop

      return desktop.e2eCompleteOkvevoSignIn('e2e-code', 'e2e-state')
    })

    expect(signedIn.ok, `sign-in failed: ${signedIn.error ?? 'unknown'}`).toBe(true)
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (
              window as unknown as {
                hermesDesktop: { getOkvevoAuth: () => Promise<{ signedIn: boolean }> }
              }
            ).hermesDesktop
              .getOkvevoAuth()
              .then(snap => snap.signedIn)
          ),
        { timeout: 30_000 }
      )
      .toBe(true)

    await waitForInteractive(app, page)

    // Normal / default session: type @ → listbox contract.
    await openMentionMenu(page)
    await expectOkvevoMentionMenu(page, 'normal session')
    await shot(page, 'mention-menu-default-session.png')
    await page.keyboard.press('Escape')

    // Bot chat: create + focus a non-default bot, open @ again.
    await openBots(page)
    await createBot(page, 'scout', 'Scout')
    await page.getByRole('button', { name: /^Scout\b/ }).first().click()
    await waitForInteractive(app, page)
    await openMentionMenu(page)
    await expectOkvevoMentionMenu(page, 'bot chat')
    await shot(page, 'mention-menu-bot-chat.png')
    await page.keyboard.press('Escape')
  } catch (error) {
    failed = true
    throw error
  } finally {
    if (failed) {
      saveFailureEvidence(sandbox.hermesHome, app)
    }

    await app.close().catch(() => undefined)
    fs.writeFileSync(packPath, originalPack)
    await mock.close()
    sandbox.cleanup()
  }
})
