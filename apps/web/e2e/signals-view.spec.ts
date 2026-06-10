import { test, expect } from '@playwright/test'

test.describe('Signals / Alerts view', () => {
  test('renders signals page with tabs', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Signals').first().click()
    await expect(page.locator('text=All Project Failures')).toBeVisible()
    // Tab buttons
    await expect(page.locator('button:has-text("All")').first()).toBeVisible()
    await expect(page.locator('button:has-text("Alerts")').first()).toBeVisible()
    await expect(page.locator('button:has-text("Errors")').first()).toBeVisible()
  })
})
