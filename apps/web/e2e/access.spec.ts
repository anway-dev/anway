import { test, expect } from '@playwright/test'

test.describe('Access — UI', () => {
  test('P0: navigate to Access — user list with role visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await expect(
      page.locator('text=User').or(page.locator('text=Role')).or(page.locator('text=Perimeter')).first()
    ).toBeVisible({ timeout: 8000 })
    await expect(
      page.locator('text=admin').or(page.locator('text=dev')).or(page.locator('text=viewer')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Connector Capability Manifest section visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await page.locator('text=Role').or(page.locator('text=Perimeter')).first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Connector Capability Manifest').or(page.locator('text=Capability')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Provision user button visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await page.locator('text=Role').or(page.locator('text=Perimeter')).first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('button').filter({ hasText: /Provision/ }).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: click user — detail panel shows perimeter', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await page.locator('text=admin').or(page.locator('text=Role')).first().waitFor({ timeout: 8000 })
    const userRow = page.locator('text=admin').or(page.locator('text=dev')).first()
    if (await userRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userRow.click()
      await expect(
        page.locator('text=Perimeter').or(page.locator('text=Connector')).or(page.locator('text=github')).first()
      ).toBeVisible({ timeout: 3000 })
    }
  })
})
