import { test, expect } from '@playwright/test'

test.describe('Lifecycle view', () => {
  test('stage flow renders without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })
})
