import * as fs from 'node:fs'
import * as path from 'node:path'

import { _electron, expect, test, type Page } from '@playwright/test'

import { appLogTail, composer, coreAppEnv, createCoreSandbox, DESKTOP_ROOT, send, waitForInteractive } from '../core/harness'

import { type ChatCall, startGatewayMock } from './gateway-mock'
import { noteRequestUrl } from './vendor-guard'

const shots = path.join(DESKTOP_ROOT, 'release', 'e2e-screenshots')

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

/** The chat turn, not a later title or memory call that quotes the same text. */
function callFor(calls: ChatCall[], marker: string): ChatCall {
  const found = calls.find(call => {
    const messages = Array.isArray(call.messages) ? call.messages : []
    return messages.some(message => messageText(message).trim() === marker)
  })
  if (!found) throw new Error(`no gateway call contained ${marker}`)
  return found
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, name) })
}

async function openModelMenu(page: Page) {
  const pill = page.locator('[data-slot="composer-root"]').getByRole('button', { name: /okvevo|auto-cost|auto-intelligence|model/i })
  await pill.first().click()
}

async function replies(page: Page): Promise<number> {
  return page.getByText('E2E_REPLY ok').count()
}

test('packed public app chats through the OkVevo mock on one launch', async () => {
  const executable = process.env.OKVEVO_E2E_EXECUTABLE || ''
  if (!executable || !fs.existsSync(executable)) {
    throw new Error('OKVEVO_E2E_EXECUTABLE must be the packed OkVevo binary')
  }

  const mock = await startGatewayMock()
  const sandbox = createCoreSandbox('okvevo-packed')
  const packPath = path.join(resourcesDir(executable), 'okvevo-pack-env.json')
  const originalPack = fs.readFileSync(packPath, 'utf8')
  const pack = JSON.parse(originalPack) as Record<string, unknown>
  pack.OKVEVO_WEB_ORIGIN = mock.origin
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`)
  fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), 'onboarding:\n  run: false\nnous:\n  guest: false\n')
  fs.writeFileSync(path.join(sandbox.hermesHome, '.env'), 'OKVEVO_API_KEY=e2e-okvevo-key\n', { mode: 0o600 })

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
    if (cost.model !== 'openrouter/auto-beta') {
      throw new Error(`wire model ${cost.model} plugins ${JSON.stringify(cost.plugins)}`)
    }
    expect(cost.plugins?.[0]?.cost_tier).toBe('medium')
    await shot(page, 'default-bot-chat.png')

    await openModelMenu(page)
    await page.getByRole('menuitem', { name: 'Intelligence', exact: true }).click()
    const intelligenceBefore = await replies(page)
    await send(page, 'ping auto intelligence')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(intelligenceBefore)
    expect(callFor(mock.calls, 'ping auto intelligence').plugins?.[0]?.cost_tier).toBe('xhigh')

    await openModelMenu(page)
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
    await page.getByRole('button', { name: /^E2E One\b/ }).first().click()
    const botBefore = await replies(page)
    await send(page, 'ping new bot')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(botBefore)

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
    const groupBefore = await replies(page)
    await send(page, 'ping group chat')
    await expect.poll(() => replies(page), { timeout: 120_000 }).toBeGreaterThan(groupBefore)
    await shot(page, 'group-chat.png')

    for (const line of appLogTail(app, 200).split('\n')) {
      const match = line.match(/https?:\/\/[^\s'")]+/)
      if (match) noteRequestUrl(match[0])
    }
    expect(composer(page)).toBeVisible()
  } finally {
    await app.close().catch(() => undefined)
    fs.writeFileSync(packPath, originalPack)
    await mock.close()
    sandbox.cleanup()
  }
})
