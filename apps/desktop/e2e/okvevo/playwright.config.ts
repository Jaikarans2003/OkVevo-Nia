import { defineConfig } from '@playwright/test'

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  reporter: 'line',
  retries: 0,
  testMatch: 'packed-chat.spec.ts',
  timeout: 600_000,
  workers: 1
})
