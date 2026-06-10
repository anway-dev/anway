import { test, expect } from '@playwright/test'

test.describe('Connectors view', () => {
  test('renders connector grid with cards', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Connectors').first().click()
    await expect(page.locator('text=Connect Your Stack')).toBeVisible()
    // At least one connector card shows
    await expect(page.locator('text=GitHub').first()).toBeVisible()
    await expect(page.locator('text=Datadog').first()).toBeVisible()
  })

  test('category filter works', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Connectors').first().click()
    // Click a category
    await page.locator('button:has-text("Observability")').first().click()
    await expect(page.locator('text=Prometheus').first()).toBeVisible()
  })
})
