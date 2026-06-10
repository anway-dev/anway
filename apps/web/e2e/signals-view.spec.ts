import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, DEMO_TENANT } from './fixtures'

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

test.describe('Signals extended', () => {
  test('severity badges visible on alert cards', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Signals').first().click()
    // At least one severity badge visible
    await expect(page.locator('text=critical').first()).toBeVisible()
  })
})

test.describe('Signals extended', () => {
  test('severity badges visible on alert cards', async ({ page, request }) => {
    await request.post(`${GATEWAY}/api/events/alert`, {
      data: { tenantId: DEMO_TENANT, title: 'E2E-badge-test', severity: 'critical' },
    })
    await page.waitForTimeout(500)
    await page.goto('/')
    await page.locator('text=Signals').first().click()
    const badge = page.locator('text=critical, text=high, text=warning, text=low').first()
    await expect(badge).toBeVisible({ timeout: 5000 })
  })
})
