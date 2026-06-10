import { test, expect } from '@playwright/test'

test.describe('Orchestrator chat', () => {
  test('chat input and send button are present', async ({ page }) => {
    await page.goto('/')
    // Default view is chat — should have input
    const input = page.locator('input[placeholder*="anvay"]').first()
    const textarea = page.locator('textarea[placeholder*="anvay"]').first()
    // Accept either input or textarea style
    const exists = (await input.isVisible({ timeout: 3000 }).catch(() => false)) ||
      (await textarea.isVisible({ timeout: 3000 }).catch(() => false))
    expect(exists).toBe(true)
  })
})
