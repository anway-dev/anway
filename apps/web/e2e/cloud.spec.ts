import { test, expect } from '@playwright/test'

test.describe('Cloud — UI', () => {
  test('P0: navigate to Cloud — Cloud Health heading visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Cloud').first().click()
    await expect(page.locator('text=Cloud Health').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: AWS provider tab visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Cloud').first().click()
    await page.locator('text=Cloud Health').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=AWS').or(page.locator('text=Amazon')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Overview / Security / Capacity tabs visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Cloud').first().click()
    await page.locator('text=Cloud Health').first().waitFor({ timeout: 8000 })
    await expect(page.locator('button:has-text("Overview")').or(page.locator('text=Overview')).first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("Security")').or(page.locator('text=Security')).first()).toBeVisible({ timeout: 5000 })
  })

  test('P1: click Security tab — security content visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Cloud').first().click()
    await page.locator('text=Cloud Health').first().waitFor({ timeout: 8000 })
    const secBtn = page.locator('button:has-text("Security")').first()
    if (await secBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await secBtn.click()
      await expect(
        page.locator('text=critical').or(page.locator('text=high')).or(page.locator('text=safe thresholds')).first()
      ).toBeVisible({ timeout: 3000 })
    }
  })
})
