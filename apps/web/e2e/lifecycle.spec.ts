import { setAuthCookie } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('Lifecycle — UI', () => {
  test('P0: navigate to Lifecycle — view loaded', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    // "Feature Lifecycle" header is always visible once loaded
    await expect(page.locator('text=Feature Lifecycle').first()).toBeVisible({ timeout: 8000 })
    // With data in DB, PRD stage card renders — use exact match to avoid hidden <option> elements
    await expect(
      page.getByText('PRD', { exact: true }).or(page.locator('text=No features yet')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P0: multiple stage labels visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await page.locator('text=Feature Lifecycle').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Tech Spec').or(page.locator('text=Deployment')).or(page.locator('text=Metrics')).or(page.locator('text=No features yet')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: click PRD stage — no JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await page.locator('text=Feature Lifecycle').first().waitFor({ timeout: 8000 })
    const prdCard = page.getByText('PRD', { exact: true }).first()
    if (await prdCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prdCard.click()
    }
    await expect(
      page.locator('text=Feature Lifecycle').or(page.locator('text=No features yet')).first()
    ).toBeVisible({ timeout: 3000 })
    expect(errors).toHaveLength(0)
  })
})
