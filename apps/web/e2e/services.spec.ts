import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, setAuthCookie } from './fixtures'

test.describe('Service Catalog', () => {
  test('GET /api/services returns list', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/services`, { headers: h })
    expect(resp.status()).toBe(200)
  })

  test('renders service cards in UI', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Services').first().click()
    await expect(page.locator('text=Service').or(page.locator('text=Dependencies')).or(page.locator('text=Catalog')).first()).toBeVisible({ timeout: 5000 })
    expect(errors).toHaveLength(0)
  })
})
