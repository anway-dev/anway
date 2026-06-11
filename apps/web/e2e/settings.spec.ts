import { test, expect } from '@playwright/test'

test.describe('Settings — UI', () => {
  test('P0: navigate to Settings — Configuration heading visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Settings').first().click()
    await expect(page.locator('text=Configuration').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: AI Provider tab visible by default', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Settings').first().click()
    await page.locator('text=Configuration').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('button:has-text("AI Provider")').or(page.locator('text=AI Provider')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P0: Connectors tab switch loads connector grid', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Settings').first().click()
    await page.locator('text=Configuration').first().waitFor({ timeout: 8000 })
    await page.locator('button:has-text("Connectors")').first().click()
    await expect(page.locator('text=GitHub').first()).toBeVisible({ timeout: 5000 })
  })

  test('P1: no JS errors on Settings load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Settings').first().click()
    await page.locator('text=Configuration').first().waitFor({ timeout: 8000 })
    expect(errors).toHaveLength(0)
  })
})
