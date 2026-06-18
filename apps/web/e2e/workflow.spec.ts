import { setAuthCookie } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('Workflows — UI', () => {
  test('P0: navigate to Workflows — Autonomy Level heading visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await expect(
      page.locator('text=Autonomy Level').or(page.locator('text=Autonomy')).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('P0: L1/L2/L3/L4 autonomy buttons or select-service message visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await page.locator('text=Autonomy').first().waitFor({ timeout: 8000 })
    // Without services, AutonomyDial shows "Select a service"; with services shows L1/L2/L3/L4 buttons
    await expect(
      page.locator('button:has-text("L1")').or(page.locator('text=Select a service')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Gate Configuration section visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await page.locator('text=Autonomy').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Gate Configuration').or(page.locator('text=Gate')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: click L2 or verify select-service message', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    await page.locator('text=Autonomy').first().waitFor({ timeout: 8000 })
    const l2Btn = page.locator('button:has-text("L2")').first()
    if (await l2Btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await l2Btn.click()
      await expect(
        page.locator('text=L2 Approve').or(page.locator('text=approval')).or(page.locator('text=Approve')).first()
      ).toBeVisible({ timeout: 3000 })
    } else {
      await expect(page.locator('text=Select a service').first()).toBeVisible({ timeout: 2000 })
    }
  })
})
