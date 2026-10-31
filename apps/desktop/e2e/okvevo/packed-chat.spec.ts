import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { appLogTail, coreAppEnv, createCoreSandbox, DESKTOP_ROOT, send, waitForInteractive } from '../core/harness'

import { type ChatCall, IMAGE_MARKER, startGatewayMock } from './gateway-mock'
import { noteRequestUrl } from './vendor-guard'

const VENDOR_REJECTED_COPY = 'The image service refused this request. Your credits were returned.'

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

function messageText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text ?? '')
      return ''
    })
    .join('')
}

function matchesMarker(call: ChatCall, marker: string): boolean {
  const messages = Array.isArray(call.messages) ? call.messages : []
  return messages.some(message => messageText(message).trim() === marker)
}

/** The chat turn. Prefer the rewritten Auto call when an earlier quote also matched. */
function callFor(calls: ChatCall[], marker: string): ChatCall {
  const found = calls.filter(call => matchesMarker(call, marker))
  const wired = found.find(call => call.model === 'openrouter/auto-beta' || call.plugins?.some(plugin => plugin.cost_tier))
  const match = wired ?? found[0]
  if (!match) throw new Error(`no gateway call contained ${marker}`)
  return match
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, name) })
}

async function openModelMenu(page: Page) {
  const pill = page.locator('[data-slot="composer-root"]').getByRole('button', { name: /okvevo|auto-cost|auto-intelligence|model/i })
  await pill.first().click()
}

function copyLogs(from: string, into: string) {
  const logs = path.join(from, 'logs')
  if (fs.existsSync(logs)) fs.cpSync(logs, path.join(into, 'logs'), { recursive: true })
  const profiles = path.join(from, 'profiles')
  if (!fs.existsSync(profiles)) return
  for (const name of fs.readdirSync(profiles)) {
    const profileLogs = path.join(profiles, name, 'logs')
    if (fs.existsSync(profileLogs)) {
      fs.cpSync(profileLogs, path.join(into, 'profiles', name, 'logs'), { recursive: true })
    }
  }
}

function saveFailureEvidence(hermesHome: string, app: ElectronApplication | undefined) {
  fs.mkdirSync(diagnostics, { recursive: true })
  copyLogs(hermesHome, path.join(diagnostics, 'sandbox'))
  const userHome = path.join(os.homedir(), '.hermes')
  if (path.resolve(userHome) !== path.resolve(hermesHome)) copyLogs(userHome, path.join(diagnostics, 'user-home'))
  if (app) fs.writeFileSync(path.join(diagnostics, 'electron-log-tail.txt'), appLogTail(app, 400))
}

async function replies(page: Page): Promise<number> {
  return page.getByText('E2E_REPLY ok').count()
}

test('packed public app chats through the OkVevo mock on one launch', async () => {
  const executable = process.env.OKVEVO_E2E_EXECUTABLE || ''
  if (!executable || !fs.existsSync(executable)) {
    throw new Error('OKVEVO_E2E_EXECUTABLE must be the packed OkVevo binary')
  }

  const now = Math.floor(Date.now() / 1000)
  const token = fakeJwt(now + 3600)
  const refreshed = fakeJwt(now + 7200)
  fs.mkdirSync(diagnostics, { recursive: true })
  const mock = await startGatewayMock({
    freshIdToken: refreshed,
    logPath: path.join(diagnostics, 'mock-requests.log')
  })
  const sandbox = createCoreSandbox('okvevo-packed')
  const packPath = path.join(resourcesDir(executable), 'okvevo-pack-env.json')
  const originalPack = fs.readFileSync(packPath, 'utf8')
  const pack = JSON.parse(originalPack) as Record<string, unknown>
  pack.OKVEVO_WEB_ORIGIN = mock.origin
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`)
  // approvals off: the image steps test error copy and rendering, not the approval card.
  fs.writeFileSync(
    path.join(sandbox.hermesHome, 'config.yaml'),
    'onboarding:\n  run: false\nnous:\n  guest: false\napprovals:\n  mode: "off"\n'
  )
  fs.writeFileSync(path.join(sandbox.hermesHome, '.env'), 'OKVEVO_API_KEY=e2e-stale-copy\n', { mode: 0o600 })
  fs.writeFileSync(path.join(sandbox.hermesHome, 'okvevo-firebase-id-token'), token, { mode: 0o600 })
  fs.writeFileSync(path.join(sandbox.hermesHome, 'okvevo-firebase-refresh-token'), 'e2e-refresh', { mode: 0o600 })

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
  page.on('request', request => noteRequestUrl(request.url()))
  let failed = false

  try {
    await waitForInteractive(app, page)
    const config = fs.readFileSync(path.join(sandbox.hermesHome, 'config.yaml'), 'utf8')
    expect(config).toContain('provider: okvevo')
    expect(config).toContain('default: okvevo/auto-cost')
    expect(config).not.toMatch(/provider: (auto|openrouter|nous)\b/)

    const before = await replies(page)
    await send(page, 'ping default bot')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(before)
    const cost = callFor(mock.calls, 'ping default bot')
    expect(cost.authorization || '').toContain(token)
    expect(fs.readFileSync(path.join(sandbox.hermesHome, '.env'), 'utf8')).not.toContain('OKVEVO_API_KEY=')
    if (cost.model !== 'openrouter/auto-beta') {
      throw new Error(`wire model ${cost.model} plugins ${JSON.stringify(cost.plugins)}`)
    }
    expect(cost.plugins?.[0]?.cost_tier).toBe('medium')
    await shot(page, 'default-bot-chat.png')

    // Portal 502 vendor_rejected: the code decides the copy, not "HTTP 403" in the message.
    mock.setFalMode('reject')
    await send(page, `${IMAGE_MARKER} rejected`)
    await expect(page.getByText(VENDOR_REJECTED_COPY).first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('Please sign in again')).toHaveCount(0)
    expect(mock.falSubmits).toBe(1)
    await shot(page, 'image-vendor-rejected.png')

    mock.setFalMode('ok')
    await send(page, `${IMAGE_MARKER} ok`)
    const picture = page.locator('[data-slot="aui_generated-image"] img[alt="Generated image"]').last()
    await expect(picture).toHaveClass(/opacity-100/, { timeout: 120_000 })
    await shot(page, 'image-ok.png')

    await openModelMenu(page)
    await page.getByRole('menuitem', { name: 'Intelligence', exact: true }).click()
    const intelligenceBefore = await replies(page)
    await send(page, 'ping auto intelligence')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(intelligenceBefore)
    expect(callFor(mock.calls, 'ping auto intelligence').plugins?.[0]?.cost_tier).toBe('xhigh')

    await openModelMenu(page)
    await page.getByRole('textbox').last().fill('gpt-4o-mini')
    await page.getByRole('menuitem', { name: /gpt-4o-mini/i }).click()
    await shot(page, 'model-picker.png')
    const specificBefore = await replies(page)
    await send(page, 'ping specific model')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(specificBefore)
    const specific = callFor(mock.calls, 'ping specific model')
    expect(specific.model).toBe('openai/gpt-4o-mini')
    expect(specific.plugins?.some(plugin => plugin.cost_tier)).toBeFalsy()

    const bots = page.getByRole('button', { name: 'Bots', exact: true }).or(page.getByRole('tab', { name: 'Bots', exact: true })).first()
    await bots.click()
    await expect(page.getByRole('button', { name: 'New bot or group chat' })).toBeVisible()

    async function createBot(slug: string, title: string) {
      await page.getByRole('button', { name: 'New bot or group chat' }).click()
      await page.getByRole('menuitem', { name: 'New Bot' }).click()
      const dialog = page.getByRole('dialog', { name: 'New Bot' })
      await dialog.getByPlaceholder('inbox-triage').fill(slug)
      await dialog.getByPlaceholder('Inbox Triage').fill(title)
      await dialog.getByRole('button', { name: 'Create Bot' }).click()
      await expect(dialog).toBeHidden({ timeout: 60_000 })
    }

    await createBot('e2eone', 'E2E One')
    await expect.poll(() => fs.existsSync(path.join(sandbox.hermesHome, 'profiles', 'e2eone', 'config.yaml'))).toBe(true)
    const botConfig = fs.readFileSync(path.join(sandbox.hermesHome, 'profiles', 'e2eone', 'config.yaml'), 'utf8')
    expect(botConfig).toContain('provider: okvevo')
    expect(botConfig).not.toMatch(/provider: (auto|openrouter|nous)\b/)
    const botEnv = path.join(sandbox.hermesHome, 'profiles', 'e2eone', '.env')
    if (fs.existsSync(botEnv)) {
      expect(fs.readFileSync(botEnv, 'utf8')).not.toContain('OKVEVO_API_KEY=')
    }
    await page.getByRole('button', { name: /^E2E One\b/ }).first().click()
    await expect(page.getByText('ping specific model', { exact: true })).toHaveCount(0)
    const botBefore = await replies(page)
    await send(page, 'ping new bot')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(botBefore)
    expect(callFor(mock.calls, 'ping new bot').authorization || '').toContain(token)

    mock.expireBearer(token)
    const afterExpiry = await replies(page)
    await send(page, 'ping after expiry')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(afterExpiry)
    const renewed = callFor(mock.calls, 'ping after expiry')
    expect(renewed.authorization || '').toContain(refreshed)
    expect(renewed.authorization || '').not.toContain(token)
    expect(mock.refreshes).toBeGreaterThan(0)
    await expect(page.getByText(/Limited until/i)).toHaveCount(0)
    await expect(page.getByText('Please sign in again')).toHaveCount(0)
    await shot(page, 'bot-after-expiry.png')

    await bots.click()
    await createBot('e2etwo', 'E2E Two')
    await page.getByRole('button', { name: 'New bot or group chat' }).click()
    await page.getByRole('menuitem', { name: 'New Group Chat' }).click()
    const room = page.getByRole('dialog', { name: 'New Group Chat' })
    for (const title of ['E2E One', 'E2E Two']) {
      await room.getByText(title, { exact: true }).locator('xpath=ancestor::label').getByRole('checkbox').click()
    }
    await room.getByRole('textbox', { name: 'Group name' }).fill('e2eroom')
    await room.getByRole('button', { name: 'Create Group (2)' }).click()
    await expect(room).toBeHidden({ timeout: 60_000 })
    const groupTab = page.getByRole('tab', { name: /e2eroom/ }).first()
    await expect(groupTab).toBeVisible()
    if ((await groupTab.getAttribute('aria-selected')) !== 'true') {
      await groupTab.getByText(/e2eroom/).first().click()
      await expect(groupTab).toHaveAttribute('aria-selected', 'true')
    }
    const groupBox = page
      .getByRole('textbox', { name: 'Group message', exact: true })
      .or(page.getByRole('textbox', { name: /Message e2eroom/ }))
      .filter({ visible: true })
      .first()
    const startGateway = page.getByRole('button', { name: 'Start gateway group' })
    await expect
      .poll(
        async () => {
          if (await groupBox.isVisible().catch(() => false)) return 'ready'
          if (await startGateway.isEnabled().catch(() => false)) {
            await startGateway.click()
          }
          return 'wait'
        },
        { timeout: 60_000 }
      )
      .toBe('ready')
    await expect(groupBox).toBeEnabled({ timeout: 60_000 })
    const visibleReplies = () => page.getByText('E2E_REPLY ok').filter({ visible: true }).count()
    const groupBefore = await visibleReplies()
    await groupBox.fill('@e2eone ping group chat')
    if ((await groupBox.getAttribute('aria-label')) === 'Group message') {
      await groupBox.locator('xpath=ancestor::form').getByRole('button', { name: 'Send', exact: true }).click()
    } else {
      await groupBox.press('Enter')
    }
    await expect.poll(visibleReplies, { timeout: 120_000 }).toBeGreaterThan(groupBefore)
    await shot(page, 'group-chat.png')

    for (const line of appLogTail(app, 200).split('\n')) {
      const match = line.match(/https?:\/\/[^\s'")]+/)
      if (match) noteRequestUrl(match[0])
    }
    await expect(groupBox).toBeVisible()
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
