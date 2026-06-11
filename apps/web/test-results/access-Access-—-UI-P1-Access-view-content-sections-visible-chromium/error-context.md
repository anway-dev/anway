# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: access.spec.ts >> Access — UI >> P1: Access view content sections visible
- Location: e2e/access.spec.ts:15:7

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
  3  | test.describe('Access — UI', () => {
  4  |   test('P0: navigate to Access — user list with role visible', async ({ page }) => {
  5  |     await page.goto('/')
  6  |     await page.locator('text=Access').first().click()
  7  |     await expect(
  8  |       page.locator('text=User').or(page.locator('text=Role')).or(page.locator('text=Perimeter')).first()
  9  |     ).toBeVisible({ timeout: 8000 })
  10 |     await expect(
  11 |       page.locator('text=admin').or(page.locator('text=dev')).or(page.locator('text=viewer')).first()
  12 |     ).toBeVisible({ timeout: 5000 })
  13 |   })
  14 | 
  15 |   test('P1: Access view content sections visible', async ({ page }) => {
> 16 |     await page.goto('/')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  17 |     await page.locator('text=Access').first().click()
  18 |     await page.locator('text=Role').or(page.locator('text=Perimeter')).or(page.locator('text=User')).first().waitFor({ timeout: 8000 })
  19 |     // Access view must show some content — user list, roles, or permissions
  20 |     const content = page.locator('text=User')
  21 |       .or(page.locator('text=Role'))
  22 |       .or(page.locator('text=Perimeter'))
  23 |       .or(page.locator('text=Connector'))
  24 |       .or(page.locator('text=github'))
  25 |       .first()
  26 |     await expect(content, 'Access view must render content').toBeVisible({ timeout: 5000 })
  27 |   })
  28 | 
  29 |   test('P1: User list or permission table visible', async ({ page }) => {
  30 |     await page.goto('/')
  31 |     await page.locator('text=Access').first().click()
  32 |     await page.locator('text=Role').or(page.locator('text=Perimeter')).or(page.locator('text=User')).first().waitFor({ timeout: 8000 })
  33 |     // Access view shows user info or connector permissions
  34 |     const hasContent = await page.locator('text=admin')
  35 |       .or(page.locator('text=dev'))
  36 |       .or(page.locator('text=viewer'))
  37 |       .or(page.locator('text=github'))
  38 |       .or(page.locator('text=datadog'))
  39 |       .or(page.locator('text=Connector'))
  40 |       .first()
  41 |       .isVisible({ timeout: 3000 })
  42 |       .catch(() => false)
  43 |     expect(hasContent, 'Access view must show user roles or connector access').toBe(true)
  44 |   })
  45 | 
  46 |   test('P1: click user — detail panel shows perimeter', async ({ page }) => {
  47 |     await page.goto('/')
  48 |     await page.locator('text=Access').first().click()
  49 |     await page.locator('text=admin').or(page.locator('text=Role')).first().waitFor({ timeout: 8000 })
  50 |     const userRow = page.locator('text=admin').or(page.locator('text=dev')).first()
  51 |     if (await userRow.isVisible({ timeout: 2000 }).catch(() => false)) {
  52 |       await userRow.click()
  53 |       await expect(
  54 |         page.locator('text=Perimeter').or(page.locator('text=Connector')).or(page.locator('text=github')).first()
  55 |       ).toBeVisible({ timeout: 3000 })
  56 |     }
  57 |   })
  58 | })
  59 | 
```