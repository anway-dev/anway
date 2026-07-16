import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: 'list',
  // CI runs the suite against the Next.js DEV server (docker-compose.dev.yml)
  // on a single shared runner; first render + on-demand compile under load is
  // legitimately slow, and the stack degrades over a ~30-min suite. The default
  // 5s expect / no action ceiling produced tail-end visibility flake on heavy
  // pages (audit rows, settings provider fields). Give CI real headroom — these
  // are visibility waits, not correctness assertions, so a larger ceiling only
  // removes false negatives.
  timeout: process.env['CI'] ? 90_000 : 30_000,
  expect: { timeout: process.env['CI'] ? 15_000 : 5_000 },
  use: {
    baseURL: 'http://localhost:8500',
    trace: 'on-first-retry',
    actionTimeout: process.env['CI'] ? 30_000 : 0,
    navigationTimeout: process.env['CI'] ? 30_000 : 0,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
