import { test, expect } from '@playwright/test'

test.describe('Intake/Routing view', () => {
  test('renders routing rules section', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Routing').first().click()
    await expect(page.locator('text=L1').or(page.locator('text=Route')).or(page.locator('text=Signal')).or(page.locator('text=Assist')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
