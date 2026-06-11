import { test, expect } from '@playwright/test'

test.describe('K8s view', () => {
  test('renders without JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await expect(page.locator('text=Namespace').or(page.locator('text=Pod')).or(page.locator('text=Cluster')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
