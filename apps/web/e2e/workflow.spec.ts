import { test, expect } from '@playwright/test'

test.describe('Workflows view', () => {
  test('P0: renders autonomy dial', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await expect(page.locator('text=Autonomy').or(page.locator('text=Gate')).or(page.locator('text=L1').or(page.locator('text=L2'))).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
