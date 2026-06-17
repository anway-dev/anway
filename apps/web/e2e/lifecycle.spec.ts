import { test, expect } from '@playwright/test'

test.describe('Lifecycle — UI', () => {
  test('P0: navigate to Lifecycle — PRD stage visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await expect(page.locator('text=PRD').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: multiple stage labels visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await page.locator('text=PRD').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Tech Spec').or(page.locator('text=Deployment')).or(page.locator('text=Metrics')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: click PRD stage — no JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await page.locator('text=PRD').first().waitFor({ timeout: 8000 })
    await page.locator('text=PRD').first().click()
    await expect(
      page.locator('text=PRD').or(page.locator('text=Problem')).or(page.locator('text=Metrics')).first()
    ).toBeVisible({ timeout: 3000 })
    expect(errors).toHaveLength(0)
  })
})
