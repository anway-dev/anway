import { test, expect } from '@playwright/test'

test.describe('K8s view', () => {
  test('renders without JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })
})
