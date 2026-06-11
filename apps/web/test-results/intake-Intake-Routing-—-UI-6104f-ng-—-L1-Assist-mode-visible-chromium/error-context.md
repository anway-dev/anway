# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: intake.spec.ts >> Intake / Routing — UI >> P0: navigate to Routing — L1 Assist mode visible
- Location: e2e/intake.spec.ts:4:7

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
  3  | test.describe('Intake / Routing — UI', () => {
  4  |   test('P0: navigate to Routing — L1 Assist mode visible', async ({ page }) => {
> 5  |     await page.goto('/')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  6  |     await page.locator('text=Routing').first().click()
  7  |     await expect(page.locator('text=L1 Assist').first()).toBeVisible({ timeout: 8000 })
  8  |   })
  9  | 
  10 |   test('P0: routing mode options visible', async ({ page }) => {
  11 |     await page.goto('/')
  12 |     await page.locator('text=Routing').first().click()
  13 |     await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
  14 |     const modeCount = await page.locator('button').filter({ hasText: /bypass|L1|Assist|route/i }).count()
  15 |     expect(modeCount).toBeGreaterThanOrEqual(1)
  16 |   })
  17 | 
  18 |   test('P1: L1 Assist shows triage description', async ({ page }) => {
  19 |     await page.goto('/')
  20 |     await page.locator('text=Routing').first().click()
  21 |     await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
  22 |     await page.locator('text=L1 Assist').first().click()
  23 |     await expect(
  24 |       page.locator('text=triage').or(page.locator('text=context')).or(page.locator('text=Anvay')).first()
  25 |     ).toBeVisible({ timeout: 3000 })
  26 |   })
  27 | })
  28 | 
  29 | test('P1: Routing mode click updates description', async ({ page }) => {
  30 |   await page.goto('/')
  31 |   await page.locator('text=Routing').first().click()
  32 |   await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
  33 |   const bypassBtn = page.locator('button').filter({ hasText: /bypass/i }).first()
  34 |   if (await bypassBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  35 |     await bypassBtn.click()
  36 |     await expect(
  37 |       page.locator('text=bypass').or(page.locator('text=auto')).first()
  38 |     ).toBeVisible({ timeout: 3000 })
  39 |   }
  40 | })
  41 | 
  42 | test('P1: no JS errors on Routing load', async ({ page }) => {
  43 |   const errors: string[] = []
  44 |   page.on('pageerror', e => errors.push(e.message))
  45 |   await page.goto('/')
  46 |   await page.locator('text=Routing').first().click()
  47 |   await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
  48 |   expect(errors).toHaveLength(0)
  49 | })
  50 | 
```