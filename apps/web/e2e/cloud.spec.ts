import { test, expect } from '@playwright/test'

test.describe('Cloud view', () => {
  test('renders cloud resource sections', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Cloud').first().click()
    await expect(page.locator('text=AWS').or(page.locator('text=GCP')).or(page.locator('text=Azure')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
