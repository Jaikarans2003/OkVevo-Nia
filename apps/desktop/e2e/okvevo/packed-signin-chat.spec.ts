import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { _electron, type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { appLogTail, backendProcesses, coreAppEnv, createCoreSandbox, DESKTOP_ROOT, send, waitForInteractive } from '../core/harness'

import { CATALOG_MODEL_IDS, type ChatCall, startGatewayMock } from './gateway-mock'

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

  if (fs.existsSync(path.join(mac, 'okvevo-pack-env.json'))) {return mac}
  const win = path.join(dir, 'resources')

  if (fs.existsSync(path.join(win, 'okvevo-pack-env.json'))) {return win}
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

async function openModelMenu(page: Page) {
  const pill = page.locator('[data-slot="composer-root"]').getByRole('button', { name: /okvevo|auto-cost|auto-intelligence|model/i })
  await pill.first().click()
}

// Row label is the id after the vendor slash ("openai/gpt-4o-mini" → "GPT-4o-mini").
function catalogRow(page: Page, id: string) {
  const base = id.slice(id.lastIndexOf('/') + 1).replace(/[.]/g, '\\.')

  return page.getByRole('menuitem', { name: new RegExp(base, 'i') })
}

const CATALOG_ROWS = CATALOG_MODEL_IDS.filter(id => !id.startsWith('okvevo/auto-'))

/** Pre-PR-1.3 the menu kept only the two Auto rows: the catalog read had no credential. */
async function expectLiveCatalog(page: Page) {
  await expect
    .poll(
      async () => {
        await openModelMenu(page)
        const shown = await Promise.all(CATALOG_ROWS.map(id => catalogRow(page, id).first().isVisible({ timeout: 3_000 }).catch(() => false)))
        const auto = await page.getByRole('menuitem', { name: /^(Cost Effective|Intelligence)$/ }).count()
        await page.keyboard.press('Escape')

        return `auto=${auto} catalog=${shown.filter(Boolean).length}/${CATALOG_ROWS.length}`
      },
      { timeout: 90_000, intervals: [3_000], message: 'model menu after sign-in must list the live catalog, not only the two Auto rows' }
    )
    .toBe(`auto=2 catalog=${CATALOG_ROWS.length}/${CATALOG_ROWS.length}`)
}

function callWith(calls: ChatCall[], text: string): ChatCall | undefined {
  return calls.find(call => JSON.stringify(call.messages ?? []).includes(text))
}

const IDENTITY = 'You are OkVevo agent, made by OkVevo.'

// What the gateway sent for the turn carrying `text`: the OkVevo identity, never upstream's Hermes
// help guidance. Auxiliary calls (title generation) carry the same text without the agent prompt and
// race the turn, so match any call, not the first.
function expectOkvevoIdentity(calls: ChatCall[], text: string, what: string) {
  const sent = calls.map(call => JSON.stringify(call.messages ?? [])).filter(body => body.includes(text))

  expect(sent.some(body => body.includes(IDENTITY)), `${what}: no call carried the OkVevo identity`).toBe(true)
  expect(sent.some(body => body.includes('hermes-agent.nousresearch.com')), `${what}: upstream help guidance leaked`).toBe(false)
}

// Same Bots selectors as upstream's e2e/group-room-native.spec.ts.
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

async function createGroup(page: Page, titles: string[], room: string) {
  await openBots(page)
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: 'New Group Chat' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Group Chat' })

  for (const title of titles) {
    await dialog.getByText(title, { exact: true }).locator('xpath=ancestor::label').getByRole('checkbox').click()
  }

  await dialog.getByRole('textbox', { name: 'Group name' }).fill(room)
  await dialog.getByRole('button', { name: `Create Group (${titles.length})` }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

function copyLogs(from: string, into: string) {
  const logs = path.join(from, 'logs')

  if (fs.existsSync(logs)) {fs.cpSync(logs, path.join(into, 'logs'), { recursive: true })}
}

function saveFailureEvidence(hermesHome: string, app: ElectronApplication | undefined) {
  fs.mkdirSync(diagnostics, { recursive: true })
  copyLogs(hermesHome, path.join(diagnostics, 'signin-sandbox'))
  const userHome = path.join(os.homedir(), '.hermes')

  if (path.resolve(userHome) !== path.resolve(hermesHome)) {copyLogs(userHome, path.join(diagnostics, 'signin-user-home'))}

  if (app) {fs.writeFileSync(path.join(diagnostics, 'signin-electron-log-tail.txt'), appLogTail(app, 400))}
}

test('packed app signs in then chats on the default bot on one launch', async () => {
  test.setTimeout(900_000)
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

    // What a user does next: open the model menu on this launch. The live
    // catalog (mock /api/gateway/models) must arrive, not only the Auto rows.
    await waitForInteractive(app, page)
    await expectLiveCatalog(page)
    await shot(page, 'signin-model-menu.png')

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
    const call = callWith(mock.calls, 'ping after sign in')
    expect(call, 'no gateway call carried the first-chat message').toBeTruthy()
    expect(call!.authorization || '').toContain(token)
    expectOkvevoIdentity(mock.calls, 'ping after sign in', 'default bot first chat')
    await expect(page.getByText('No usable credentials found')).toHaveCount(0)
    // v0.23.0 re-asks shared metrics unless offer_version is set; public builds never offer Nous.
    await expect(page.getByText('Share with Nous')).toHaveCount(0)
    await shot(page, 'signin-first-chat.png')

    // Pick a listed catalog model; that id, not an Auto alias, reaches the gateway.
    const picked = 'openai/gpt-4o-mini'
    await openModelMenu(page)
    await catalogRow(page, picked).first().click()
    const repliesBefore = await page.getByText('E2E_REPLY ok').count()
    await send(page, 'ping picked model')
    await expect.poll(() => page.getByText('E2E_REPLY ok').count(), { timeout: 120_000 }).toBeGreaterThan(repliesBefore)
    await expect
      .poll(() => callWith(mock.calls, 'ping picked model')?.model, { timeout: 60_000, message: 'picked model never reached the gateway' })
      .toBe(picked)
    await shot(page, 'signin-picked-model.png')

    // Hermes v0.23.0 runs every profile on this one gateway. Bots created now, on the same launch,
    // must be provisioned for OkVevo and answer as OkVevo, alone and inside a group chat. The New Bot
    // dialog writes the bot's own SOUL ("**Role:** <title>"), which provisioning keeps by design; the
    // identity rides the OkVevo help guidance in every prompt.
    const bots: Array<[string, string]> = [['scout', 'Scout'], ['critic', 'Critic']]
    await openBots(page)
    // v0.23.0's roster leaves the default profile's display_name empty, so it reads "OkVevo agent", not
    // "default" (the retired default_agent_label workaround, Applied-Upstream v0.23.0).
    await expect(page.getByRole('button', { name: /^OkVevo agent\b/ }).first()).toBeVisible({ timeout: 60_000 })

    for (const [name, title] of bots) {
      await createBot(page, name, title)
      const config = path.join(sandbox.hermesHome, 'profiles', name, 'config.yaml')
      await expect
        .poll(() => fs.existsSync(config) && /provider:\s*okvevo/.test(fs.readFileSync(config, 'utf8')), { timeout: 60_000, message: `${name} config.yaml is not provisioned for OkVevo` })
        .toBe(true)
      const role = `**Role:** ${title}`
      await expect.poll(() => Boolean(callWith(mock.calls, role)), { timeout: 120_000, message: `${name} never took its own turn` }).toBe(true)
      expectOkvevoIdentity(mock.calls, role, `${name} first turn`)
    }

    await createGroup(page, bots.map(([, title]) => title), 'Critic, Scout')
    const groupComposer = page.getByRole('textbox', { name: 'Group message', exact: true }).filter({ visible: true })
    await expect(groupComposer).toBeVisible({ timeout: 60_000 })
    await expect(async () => {
      await groupComposer.fill('@scout @critic ping the group')
      await groupComposer.press('Enter')
      await expect.poll(() => groupComposer.evaluate(el => (el as HTMLTextAreaElement).value ?? el.textContent ?? ''), { timeout: 10_000 }).toBe('')
    }).toPass({ timeout: 150_000 })

    for (const [name] of bots) {
      const handle = `You are @${name}`
      await expect.poll(() => Boolean(callWith(mock.calls, handle)), { timeout: 120_000, message: `@${name} never took a group turn` }).toBe(true)
      expectOkvevoIdentity(mock.calls, handle, `@${name} group turn`)
    }

    await shot(page, 'signin-group-chat.png')
  } catch (error) {
    failed = true
    throw error
  } finally {
    if (failed) {saveFailureEvidence(sandbox.hermesHome, app)}
    await app.close().catch(() => undefined)
    fs.writeFileSync(packPath, originalPack)
    await mock.close()
    sandbox.cleanup()
  }
})
