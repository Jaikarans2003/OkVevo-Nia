/**
 * E2E: UI scale is locked at Chromium actual-size (100%). setPercent and
 * in-page navigation must not drift — the main process reasserts 100%.
 *
 * Prerequisite: `npm run build` must have been run so dist/ exists.
 */

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null

async function readZoomPercent(): Promise<number> {
  return fixture!.page.evaluate(async () => {
    const desktop = window as unknown as {
      hermesDesktop: { zoom: { get: () => Promise<{ percent: number }> } }
    }

    return (await desktop.hermesDesktop.zoom.get()).percent
  })
}

async function gotoRoute(route: string): Promise<void> {
  const page = fixture!.page

  await page.evaluate(target => {
    window.location.hash = target
  }, route)
  await page.waitForFunction(target => window.location.hash === `#${target}`, route)
}

test.beforeAll(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('zoom stays locked at 100% across navigation even if setPercent asks for 110', async () => {
  await fixture!.page.evaluate(() => {
    const desktop = window as unknown as {
      hermesDesktop: { zoom: { setPercent: (percent: number) => void } }
    }

    desktop.hermesDesktop.zoom.setPercent(110)
  })
  await expect.poll(readZoomPercent).toBe(100)

  const fresh = `/e2e-zoom-${Date.now()}`

  for (const route of [`${fresh}-one`, `${fresh}-two`, '/settings?tab=config%3Aappearance']) {
    await gotoRoute(route)
    await expect.poll(readZoomPercent, { message: `UI scale after navigating to ${route}` }).toBe(100)
  }
})

test('Cmd/Ctrl+N keeps zoom at 100%', async () => {
  const page = fixture!.page

  await gotoRoute('/settings')

  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N')
  await page.waitForFunction(() => window.location.hash === '#/')

  await expect.poll(readZoomPercent).toBe(100)
})
