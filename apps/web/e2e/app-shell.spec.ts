import { test, expect } from '@playwright/test'

test.describe('App shell', () => {
  test('renders sidebar with navigation and logo', async ({ page }) => {
    await page.goto('/')
    // Logo
    await expect(page.locator('text=anvay').first()).toBeVisible()
    // Nav items
    await expect(page.locator('text=Signals').first()).toBeVisible()
    await expect(page.locator('text=Services').first()).toBeVisible()
    await expect(page.locator('text=Audit').first()).toBeVisible()
    await expect(page.locator('text=Connectors').first()).toBeVisible()
  })

  test('navigates between views', async ({ page }) => {
    await page.goto('/')
    // Click Audit in sidebar
    await page.locator('text=Audit').first().click()
    await expect(page.locator('text=Audit Trail')).toBeVisible()
    // Click Connectors
    await page.locator('text=Connectors').first().click()
    await expect(page.locator('text=Connect Your Stack')).toBeVisible()
  })
})
