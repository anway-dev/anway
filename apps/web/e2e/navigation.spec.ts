import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('all sidebar nav items exist', async ({ page }) => {
    await page.goto('/')
    const navItems = ['Anvay', 'Signals', 'War Room', 'Services', 'Lifecycle',
      'Editor', 'Knowledge', 'Workflows', 'Approvals', 'Automations',
      'API Client', 'Connectors', 'Audit', 'Access', 'Cloud', 'K8s']
    for (const item of navItems) {
      const loc = page.locator(`text=${item}`).first()
      await loc.scrollIntoViewIfNeeded()
      await expect(loc).toBeVisible()
    }
  })

  test('view switching updates content area', async ({ page }) => {
    await page.goto('/')
    // Services
    await page.locator('text=Services').first().click()
    // Should show service catalog or related content
    // Incident/War Room
    await page.locator('text=War Room').first().click()
  })
})
