import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    actionTimeout: 15_000,
    headless: true,
  },
})
