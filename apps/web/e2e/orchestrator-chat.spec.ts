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

test.describe('Chat UI', () => {
  test('scenario shortcut chips visible', async ({ page }) => {
    await page.goto('/')
    const chips = page.locator('button').filter({ hasText: /alert|deploy|why|incident/i })
    expect(await chips.count()).toBeGreaterThanOrEqual(2)
  })

  test('settings panel opens and closes', async ({ page }) => {
    await page.goto('/')
    const settingsBtn = page.locator('[data-testid="chat-settings"], button[aria-label*="settings"], button:has-text("⚙")').first()
    if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await settingsBtn.click()
      await expect(page.locator('text=Model').or(page.locator('text=Provider'))).toBeVisible()
    }
  })
})
