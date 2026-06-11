import { test, expect } from '@playwright/test'

test.describe('Settings view', () => {
  test('P0: renders settings panel', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Settings').first().click()
    await expect(page.locator('text=AI Provider').or(page.locator('text=Connectors')).or(page.locator('text=Access')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
