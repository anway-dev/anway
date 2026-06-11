import { test, expect } from '@playwright/test'

test.describe('Access view', () => {
  test('renders user provisioning section', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await expect(page.locator('text=User').or(page.locator('text=Role')).or(page.locator('text=Perimeter')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
