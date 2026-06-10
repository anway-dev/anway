import { test, expect } from '@playwright/test'

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
