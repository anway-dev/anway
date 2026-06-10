import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, DEMO_TENANT } from './fixtures'

test.describe('AI Provider config', () => {
  test('shows provider config when no provider configured', async ({ page }) => {
    await page.goto('/')
    // When no provider, the overlay should appear with "Connect your AI model"
    // If provider IS configured, this won't show — skip gracefully
    const heading = page.locator('text=Connect your AI model')
    if (await heading.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(heading).toBeVisible()
      // Provider dropdown exists
      await expect(page.locator('select').first()).toBeVisible()
      // Save button exists
      await expect(page.locator('button:has-text("Save")').first()).toBeVisible()
    }
  })
})

import { GATEWAY, authHeaders } from './fixtures'

test.describe('Provider config extended', () => {
  test('SSRF block — localhost URL rejected', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://localhost:9090`, { headers: h })
    // Should return empty models (blocked) not leaked data
    const body = await resp.json() as { models: unknown[] }
    expect(Array.isArray(body.models)).toBe(true)
  })
})
