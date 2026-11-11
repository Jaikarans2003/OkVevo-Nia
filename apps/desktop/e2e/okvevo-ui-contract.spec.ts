/**
 * OkVevo UI-CONTRACT visual suite — six public screens, hard per-OS baselines.
 *
 * Update baselines only with:
 *   npx playwright test e2e/okvevo-ui-contract.spec.ts --update-snapshots
 *
 * See docs/okvevo/UI-CONTRACT.md.
 */
import {
  type MockBackendFixture,
  type NoProviderFixture,
  setupMockBackend,
  setupNoProvider,
  waitForAppReady,
  waitForOnboarding
} from './fixtures'
import { expect, test } from './test'
import { assertContractScreenshot } from './visual-snapshot'

const MASK = [
  '[data-slot="credit-balance"]',
  '[data-slot="statusbar-credits"]',
  'time',
  '[data-testid="session-timestamp"]'
]

test.describe('OkVevo UI contract (public screens)', () => {
  // Boot + six screens on cold CI runners (Mac/Windows) needs headroom past
  // Playwright's 90s default — waitForAppReady alone allows 120s.
  test.describe.configure({ timeout: 180_000 })

  test.describe('signed-in shell', () => {
    let fixture: MockBackendFixture | null = null

    test.beforeAll(async () => {
      fixture = await setupMockBackend()
      await waitForAppReady(fixture, 120_000)
    })

    test.afterAll(async () => {
      await fixture?.cleanup()
      fixture = null
    })

    test('chat', async () => {
      await assertContractScreenshot(fixture!.page, {
        name: 'contract-chat',
        app: fixture!.app,
        mask: MASK
      })
      await expect(fixture!.page.locator('[data-slot="composer-disclaimer"]')).toBeVisible()
    })

    test('bots', async () => {
      const page = fixture!.page
      const bots = page.getByRole('button', { name: /bots/i }).first()

      if (await bots.count()) {await bots.click()}
      await page.waitForTimeout(400)
      await assertContractScreenshot(page, { name: 'contract-bots', app: fixture!.app, mask: MASK })
    })

    test('model menu', async () => {
      const page = fixture!.page
      const model = page.locator('[data-slot="model-pill"], [aria-label*="model" i]').first()

      if (await model.count()) {await model.click()}
      await page.waitForTimeout(400)
      await assertContractScreenshot(page, { name: 'contract-model-menu', app: fixture!.app, mask: MASK })
      await page.keyboard.press('Escape')
    })

    test('settings', async () => {
      const page = fixture!.page
      const settings = page.getByRole('button', { name: /settings/i }).first()

      if (await settings.count()) {await settings.click()}
      await page.waitForTimeout(400)
      await assertContractScreenshot(page, { name: 'contract-settings', app: fixture!.app, mask: MASK })
      await page.keyboard.press('Escape')
    })

    test('about', async () => {
      const page = fixture!.page
      // Trigger the native About panel when the bridge exposes it; otherwise
      // snapshot the shell chrome that still carries product branding.
      await page.evaluate(async () => {
        const desktop = (window as unknown as { hermesDesktop?: { showAbout?: () => void } }).hermesDesktop
        desktop?.showAbout?.()
      })
      await page.waitForTimeout(400)
      await assertContractScreenshot(page, { name: 'contract-about', app: fixture!.app, mask: MASK })
    })
  })

  test.describe('sign-in / onboarding', () => {
    let fixture: NoProviderFixture | null = null

    test.afterAll(async () => {
      await fixture?.cleanup()
      fixture = null
    })

    test('sign-in', async () => {
      fixture = await setupNoProvider()
      await waitForOnboarding(fixture.page, 90_000)
      await assertContractScreenshot(fixture.page, {
        name: 'contract-sign-in',
        app: fixture.app,
        mask: MASK
      })
    })
  })
})

