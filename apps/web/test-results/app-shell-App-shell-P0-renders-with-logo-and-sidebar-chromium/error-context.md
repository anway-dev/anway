# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app-shell.spec.ts >> App shell >> P0: renders with logo and sidebar
- Location: e2e/app-shell.spec.ts:4:7

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
  3  | test.describe('App shell', () => {
  4  |   test('P0: renders with logo and sidebar', async ({ page }) => {
> 5  |     await page.goto('/')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  6  |     await expect(page.locator('text=anvay').first()).toBeVisible()
  7  |     await expect(page.locator('text=Signals').first()).toBeVisible()
  8  |   })
  9  | 
  10 |   test('P0: no console errors on load', async ({ page }) => {
  11 |     const errors: string[] = []
  12 |     page.on('pageerror', e => errors.push(e.message))
  13 |     await page.goto('/')
  14 |     await page.waitForLoadState('networkidle')
  15 |     expect(errors).toHaveLength(0)
  16 |   })
  17 | })
  18 | 
```