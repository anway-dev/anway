# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api-client.spec.ts >> API Client — UI >> P0: navigate to API Client — Collections and Send button visible
- Location: e2e/api-client.spec.ts:4:7

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
  3  | test.describe('API Client — UI', () => {
  4  |   test('P0: navigate to API Client — Collections and Send button visible', async ({ page }) => {
> 5  |     await page.goto('/')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  6  |     await page.locator('text=API Client').first().click()
  7  |     await expect(page.locator('text=Collections').first()).toBeVisible({ timeout: 8000 })
  8  |     await expect(page.locator('button:has-text("Send")').first()).toBeVisible({ timeout: 5000 })
  9  |   })
  10 | 
  11 |   test('P0: HTTP method options visible', async ({ page }) => {
  12 |     await page.goto('/')
  13 |     await page.locator('text=API Client').first().click()
  14 |     await page.locator('text=Collections').first().waitFor({ timeout: 8000 })
  15 |     await expect(
  16 |       page.locator('text=POST').or(page.locator('text=GET')).first()
  17 |     ).toBeVisible({ timeout: 5000 })
  18 |   })
  19 | 
  20 |   test('P1: click collection request — URL area updates', async ({ page }) => {
  21 |     await page.goto('/')
  22 |     await page.locator('text=API Client').first().click()
  23 |     await page.locator('text=Collections').first().waitFor({ timeout: 8000 })
  24 |     const req = page.locator('text=/v2/').or(page.locator('text=/auth/')).first()
  25 |     if (await req.isVisible({ timeout: 2000 }).catch(() => false)) {
  26 |       await req.click()
  27 |       await expect(
  28 |         page.locator('input[value*="/"]').or(page.locator('text=/v2/')).first()
  29 |       ).toBeVisible({ timeout: 3000 })
  30 |     }
  31 |   })
  32 | 
  33 |   test('P1: click Send — response area shows', async ({ page }) => {
  34 |     await page.goto('/')
  35 |     await page.locator('text=API Client').first().click()
  36 |     await page.locator('button:has-text("Send")').first().waitFor({ timeout: 8000 })
  37 |     await page.locator('button:has-text("Send")').first().click()
  38 |     await expect(
  39 |       page.locator('text=200').or(page.locator('text=201')).or(page.locator('text=Status')).first()
  40 |     ).toBeVisible({ timeout: 5000 })
  41 |   })
  42 | })
  43 | 
```