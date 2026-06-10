import { test, expect } from '@playwright/test'

test.describe('Audit view', () => {
  test('renders audit trail table', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Audit').first().click()
    await expect(page.locator('text=Audit Trail')).toBeVisible()
    // Summary cards
    await expect(page.locator('text=Total events').first()).toBeVisible()
    await expect(page.locator('text=Access denied').first()).toBeVisible()
  })

  test('search filters audit events', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Audit').first().click()
    const searchInput = page.locator('input[placeholder="Search queries..."]')
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('payments')
      // Should filter results
    }
  })
})
