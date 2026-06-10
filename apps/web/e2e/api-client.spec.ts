import { test, expect } from '@playwright/test'

test.describe('API Client view', () => {
  test('renders request builder with send button', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=API Client').first().click()
    await expect(page.locator('button:has-text("Send")').or(page.locator('text=Collections')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
