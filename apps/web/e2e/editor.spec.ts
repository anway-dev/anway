import { test, expect } from '@playwright/test'

test.describe('Editor view', () => {
  test('renders editor panel', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await expect(page.locator('text=Findings').or(page.locator('text=Gate')).or(page.locator('text=Review')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
