import { setAuthCookie } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('App shell', () => {
  test('P0: renders with logo and sidebar', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await expect(page.locator('text=anway').first()).toBeVisible()
    await expect(page.locator('text=Signals').first()).toBeVisible()
  })

  test('P0: no console errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    expect(errors).toHaveLength(0)
  })
})
