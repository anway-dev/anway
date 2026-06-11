import { test, expect } from '@playwright/test'

test.describe('Lifecycle view', () => {
  test('P0: renders stage flow labels', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await expect(page.locator('text=PRD').or(page.locator('text=Deploy')).or(page.locator('text=TechSpec')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
