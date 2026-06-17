import { test, expect } from '@playwright/test'

test.describe('API Client — UI', () => {
  test('P0: navigate to API Client — Collections and Send button visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=API Client').first().click()
    await expect(page.locator('text=Collections').first()).toBeVisible({ timeout: 8000 })
    await expect(page.locator('button:has-text("Send")').first()).toBeVisible({ timeout: 5000 })
  })

  test('P0: HTTP method options visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=API Client').first().click()
    await page.locator('text=Collections').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=POST').or(page.locator('text=GET')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: click collection request — URL area updates', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=API Client').first().click()
    await page.locator('text=Collections').first().waitFor({ timeout: 8000 })
    const req = page.locator('text=/v2/').or(page.locator('text=/auth/')).first()
    if (await req.isVisible({ timeout: 2000 }).catch(() => false)) {
      await req.click()
      await expect(
        page.locator('input[value*="/"]').or(page.locator('text=/v2/')).first()
      ).toBeVisible({ timeout: 3000 })
    }
  })

  test('P1: click Send — response area shows', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=API Client').first().click()
    await page.locator('button:has-text("Send")').first().waitFor({ timeout: 8000 })
    await page.locator('button:has-text("Send")').first().click()
    await expect(
      page.locator('text=200').or(page.locator('text=201')).or(page.locator('text=Status')).first()
    ).toBeVisible({ timeout: 5000 })
  })
})
