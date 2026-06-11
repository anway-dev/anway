import { test, expect } from '@playwright/test'

test.describe('Workflows — UI', () => {
  test('P0: navigate to Workflows — Autonomy Level heading visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await expect(
      page.locator('text=Autonomy Level').or(page.locator('text=Autonomy')).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('P0: L1/L2/L3/L4 autonomy buttons all visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await page.locator('text=Autonomy').first().waitFor({ timeout: 8000 })
    await expect(page.locator('button:has-text("L1")').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("L2")').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("L3")').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("L4")').first()).toBeVisible({ timeout: 5000 })
  })

  test('P1: Gate Configuration section visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await page.locator('text=Autonomy').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Gate Configuration').or(page.locator('text=Gate')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: click L2 — Approve description visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await page.locator('button:has-text("L2")').first().waitFor({ timeout: 8000 })
    await page.locator('button:has-text("L2")').first().click()
    await expect(
      page.locator('text=L2 Approve').or(page.locator('text=approval')).or(page.locator('text=Approve')).first()
    ).toBeVisible({ timeout: 3000 })
  })
})
