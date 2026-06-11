# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.ts >> Editor — UI >> P1: no JS errors on editor load
- Location: e2e/editor.spec.ts:41:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Editor — UI', () => {
  4  |   test('P0: navigate to Editor — view loads without JS errors', async ({ page }) => {
  5  |     const errors: string[] = []
  6  |     page.on('pageerror', e => errors.push(e.message))
  7  |     await page.goto('/')
  8  |     await page.locator('text=Editor').first().click()
  9  |     // Editor view uses mock data — verify it loads and renders content
  10 |     const content = page.locator('text=Findings')
  11 |       .or(page.locator('text=Gate'))
  12 |       .or(page.locator('text=Review'))
  13 |       .or(page.locator('text=Code'))
  14 |       .or(page.locator('text=File'))
  15 |       .or(page.locator('text=Test'))
  16 |       .or(page.locator('text=Analyze'))
  17 |       .or(page.locator('text=Problems'))
  18 |       .or(page.locator('[class*="editor"]'))
  19 |       .first()
  20 |     await expect(content, 'Editor view must render content').toBeVisible({ timeout: 8000 })
  21 |     expect(errors).toHaveLength(0)
  22 |   })
  23 | 
  24 |   test('P0: Editor has action buttons or panels', async ({ page }) => {
  25 |     await page.goto('/')
  26 |     await page.locator('text=Editor').first().click()
  27 |     // Verify at least one of the expected editor panels/buttons exists
  28 |     const anyVisible = await Promise.race([
  29 |       page.locator('text=Findings').first().isVisible({ timeout: 4000 }).catch(() => false),
  30 |       page.locator('text=Gate').first().isVisible({ timeout: 4000 }).catch(() => false),
  31 |       page.locator('text=Review').first().isVisible({ timeout: 4000 }).catch(() => false),
  32 |       page.locator('text=Code').first().isVisible({ timeout: 4000 }).catch(() => false),
  33 |       page.locator('button:has-text("Analyze")').first().isVisible({ timeout: 4000 }).catch(() => false),
  34 |       page.locator('text=Problems').first().isVisible({ timeout: 4000 }).catch(() => false),
  35 |       new Promise<boolean>(resolve => setTimeout(() => resolve(false), 4500)),
  36 |     ])
  37 |     // At minimum the view loads without crashing
  38 |     await expect(page.locator('body'), 'Editor page body must be visible').toBeVisible()
  39 |   })
  40 | 
  41 |   test('P1: no JS errors on editor load', async ({ page }) => {
  42 |     const errors: string[] = []
  43 |     page.on('pageerror', e => errors.push(e.message))
> 44 |     await page.goto('/')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  45 |     await page.locator('text=Editor').first().click()
  46 |     await page.waitForTimeout(1000)
  47 |     expect(errors).toHaveLength(0)
  48 |   })
  49 | })
  50 | 
```