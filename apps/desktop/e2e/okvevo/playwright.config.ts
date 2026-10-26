import path from 'node:path'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  outputDir: path.join(process.cwd(), 'release', 'e2e-playwright'),
  reporter: 'line',
  retries: 0,
  testMatch: 'packed-chat.spec.ts',
  timeout: 600_000,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  workers: 1
})
