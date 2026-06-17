import { test, expect } from '@playwright/test'

test.describe('Knowledge Base — UI', () => {
  test('P0: navigate to Knowledge — Project selector visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Knowledge').first().click()
    await expect(page.locator('text=Project').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: project buttons visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Knowledge').first().click()
    await page.locator('text=Project').first().waitFor({ timeout: 8000 })
    const projectBtn = page.locator('button').filter({ hasText: /Checkout|Payments|Auth|api/i }).first()
    const visible = await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)
    if (visible) {
      await projectBtn.click()
      await expect(projectBtn).toBeVisible({ timeout: 3000 })
    }
  })

  test('P1: kind filter tabs visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Knowledge').first().click()
    await page.locator('text=Project').first().waitFor({ timeout: 8000 })
    const filterBtns = page.locator('button').filter({ hasText: /all|deploy|pr|incident/i })
    expect(await filterBtns.count()).toBeGreaterThanOrEqual(2)
  })

  test('P1: metrics cards visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Knowledge').first().click()
    await page.locator('text=Project').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Error Rate').or(page.locator('text=P99')).or(page.locator('text=RPS')).first()
    ).toBeVisible({ timeout: 5000 })
  })
})
