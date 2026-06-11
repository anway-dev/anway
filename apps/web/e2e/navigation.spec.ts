import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('P0: all sidebar nav items exist', async ({ page }) => {
    await page.goto('/')
    for (const item of ['Signals', 'War Room', 'Services', 'Lifecycle', 'Editor', 'Knowledge', 'Workflows', 'Automations', 'API Client', 'Connectors', 'Audit', 'Access', 'Settings', 'Cloud', 'K8s']) {
      await expect(page.locator('text=' + item).first()).toBeVisible()
    }
  })

  test('P0: view switching renders correct content', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Audit').first().click()
    await expect(page.locator('text=Audit Trail')).toBeVisible({ timeout: 5000 })
  })
})
