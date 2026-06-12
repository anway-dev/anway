import { test, expect } from '@playwright/test'
import { setAuthCookie } from './fixtures'

test.describe('Editor — UI', () => {
  test('P0: navigate to Editor — view loads without JS errors', async ({ page, context }) => {
    await setAuthCookie(context)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    // Editor view uses mock data — verify it loads and renders content
    const content = page.locator('text=Findings')
      .or(page.locator('text=Gate'))
      .or(page.locator('text=Review'))
      .or(page.locator('text=Code'))
      .or(page.locator('text=File'))
      .or(page.locator('text=Test'))
      .or(page.locator('text=Analyze'))
      .or(page.locator('text=Problems'))
      .or(page.locator('[class*="editor"]'))
      .first()
    await expect(content, 'Editor view must render content').toBeVisible({ timeout: 8000 })
    expect(errors).toHaveLength(0)
  })

  test('P0: Editor has action buttons or panels', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    // Verify at least one expected editor element exists
    await expect(page.locator('body')).toBeVisible()
    const viewLoaded = await page.locator('text=Findings')
      .or(page.locator('text=Gate'))
      .or(page.locator('text=Review'))
      .or(page.locator('text=Code'))
      .or(page.locator('text=File'))
      .or(page.locator('button:has-text("Analyze")'))
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    expect(viewLoaded, 'Editor must load without crashing').toBe(true)
  })

  test('P1: no JS errors on editor load', async ({ page, context }) => {
    await setAuthCookie(context)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })
})
