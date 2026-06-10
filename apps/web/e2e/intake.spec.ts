import { test, expect } from '@playwright/test'

test.describe('Intake/Routing view', () => {
  test('renders without JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Routing').first().click()
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })
})
