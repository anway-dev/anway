# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cloud.spec.ts >> Cloud — UI >> P0: navigate to Cloud — Cloud Health heading visible
- Location: e2e/cloud.spec.ts:4:7

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
  3  | test.describe('Cloud — UI', () => {
  4  |   test('P0: navigate to Cloud — Cloud Health heading visible', async ({ page }) => {
> 5  |     await page.goto('/')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  6  |     await page.locator('text=Cloud').first().click()
  7  |     await expect(page.locator('text=Cloud Health').first()).toBeVisible({ timeout: 8000 })
  8  |   })
  9  | 
  10 |   test('P0: AWS provider tab visible', async ({ page }) => {
  11 |     await page.goto('/')
  12 |     await page.locator('text=Cloud').first().click()
  13 |     await page.locator('text=Cloud Health').first().waitFor({ timeout: 8000 })
  14 |     await expect(
  15 |       page.locator('text=AWS').or(page.locator('text=Amazon')).first()
  16 |     ).toBeVisible({ timeout: 5000 })
  17 |   })
  18 | 
  19 |   test('P1: Overview / Security / Capacity tabs visible', async ({ page }) => {
  20 |     await page.goto('/')
  21 |     await page.locator('text=Cloud').first().click()
  22 |     await page.locator('text=Cloud Health').first().waitFor({ timeout: 8000 })
  23 |     await expect(page.locator('button:has-text("Overview")').or(page.locator('text=Overview')).first()).toBeVisible({ timeout: 5000 })
  24 |     await expect(page.locator('button:has-text("Security")').or(page.locator('text=Security')).first()).toBeVisible({ timeout: 5000 })
  25 |   })
  26 | 
  27 |   test('P1: click Security tab — security content visible', async ({ page }) => {
  28 |     await page.goto('/')
  29 |     await page.locator('text=Cloud').first().click()
  30 |     await page.locator('text=Cloud Health').first().waitFor({ timeout: 8000 })
  31 |     const secBtn = page.locator('button:has-text("Security")').first()
  32 |     if (await secBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  33 |       await secBtn.click()
  34 |       await expect(
  35 |         page.locator('text=critical').or(page.locator('text=high')).or(page.locator('text=safe thresholds')).first()
  36 |       ).toBeVisible({ timeout: 3000 })
  37 |     }
  38 |   })
  39 | })
  40 | 
```