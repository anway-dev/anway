import { test, expect } from '@playwright/test'

test.describe('Knowledge Base view', () => {
  test('P0: renders entity list or search', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Knowledge').first().click()
    await expect(page.locator('input[placeholder*="earch"]').or(page.locator('text=Entity')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
