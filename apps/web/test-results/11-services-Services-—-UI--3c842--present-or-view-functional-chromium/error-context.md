# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 11-services.spec.ts >> Services — UI >> P1: health filter buttons present or view functional
- Location: e2e/11-services.spec.ts:75:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | import { GATEWAY, authHeaders } from './fixtures'
  3   | 
  4   | test.describe('Services — API', () => {
  5   |   let headers: Record<string, string>
  6   | 
  7   |   test.beforeAll(async ({ request }) => {
  8   |     headers = await authHeaders(request)
  9   |   })
  10  | 
  11  |   test('P0: GET /api/services returns 200, array, each item has id/name/health', async ({ request }) => {
  12  |     const resp = await request.get(`${GATEWAY}/api/services`, { headers })
  13  |     expect(resp.status(), 'GET /api/services must return 200').toBe(200)
  14  |     const body = await resp.json() as Array<{ id?: string; name?: string; health?: string }>
  15  |     expect(Array.isArray(body), 'services response must be an array').toBe(true)
  16  | 
  17  |     // If there are services, each must have id, name, health
  18  |     for (const svc of body) {
  19  |       expect(svc.id, `service must have an id`).toBeDefined()
  20  |       expect(svc.name, `service ${svc.id} must have a name`).toBeDefined()
  21  |       expect(svc.health, `service ${svc.name} must have a health field`).toBeDefined()
  22  |     }
  23  |   })
  24  | })
  25  | 
  26  | test.describe('Services — UI', () => {
  27  |   test('P0: navigate to Services, content area visible', async ({ page }) => {
  28  |     await page.goto('/')
  29  |     await page.locator('text=Services').first().click()
  30  |     // Services page must render — accept any content that appears
  31  |     const content = page.locator('text=Services')
  32  |       .or(page.locator('text=Service'))
  33  |       .or(page.locator('text=Dependencies'))
  34  |       .or(page.locator('text=Catalog'))
  35  |       .or(page.locator('text=Health'))
  36  |       .or(page.locator('text=Metrics'))
  37  |       .or(page.locator('text=Repo'))
  38  |       .or(page.locator('[class*="service"]'))
  39  |       .first()
  40  |     await expect(content, 'Services view must render content').toBeVisible({ timeout: 8000 })
  41  |   })
  42  | 
  43  |   test('P0: click a service or view renders detail panel', async ({ page }) => {
  44  |     await page.goto('/')
  45  |     await page.locator('text=Services').first().click()
  46  |     await page.waitForTimeout(500)
  47  | 
  48  |     // Try clicking any service-like element
  49  |     const anyItem = page.locator('text=payments')
  50  |       .or(page.locator('text=auth'))
  51  |       .or(page.locator('text=checkout'))
  52  |       .or(page.locator('text=catalog'))
  53  |       .or(page.locator('[class*="service-item"]'))
  54  |       .first()
  55  |     const found = await anyItem.isVisible({ timeout: 3000 }).catch(() => false)
  56  | 
  57  |     if (found) {
  58  |       await anyItem.click()
  59  |       await page.waitForTimeout(300)
  60  |       const detail = page.locator('text=Error Rate')
  61  |         .or(page.locator('text=P99'))
  62  |         .or(page.locator('text=RPS'))
  63  |         .or(page.locator('text=Uptime'))
  64  |         .or(page.locator('text=Team'))
  65  |         .or(page.locator('text=Metrics'))
  66  |         .or(page.locator('text=Repo'))
  67  |         .first()
  68  |       await expect(detail, 'Service detail or metrics must appear').toBeVisible({ timeout: 5000 })
  69  |     } else {
  70  |       // No services found — page still loaded without crashing
  71  |       await expect(page.locator('body'), 'Services page body must be visible').toBeVisible()
  72  |     }
  73  |   })
  74  | 
  75  |   test('P1: health filter buttons present or view functional', async ({ page }) => {
> 76  |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  77  |     await page.locator('text=Services').first().click()
  78  |     await page.waitForTimeout(500)
  79  | 
  80  |     // Check if health filters exist
  81  |     const healthyFilter = page.locator('button:has-text("Healthy")')
  82  |       .or(page.locator('button:has-text("healthy")'))
  83  |       .or(page.locator('button:has-text("All")'))
  84  |       .or(page.locator('[class*="filter"]'))
  85  |       .first()
  86  |     const filterVisible = await healthyFilter.isVisible({ timeout: 3000 }).catch(() => false)
  87  | 
  88  |     if (filterVisible) {
  89  |       await healthyFilter.click()
  90  |       await page.waitForTimeout(300)
  91  |     }
  92  |     // Page must be functional
  93  |     await expect(page.locator('body'), 'Services page body must be visible').toBeVisible()
  94  |   })
  95  | 
  96  |   test('P1: service detail or summary info visible', async ({ page }) => {
  97  |     await page.goto('/')
  98  |     await page.locator('text=Services').first().click()
  99  |     await page.waitForTimeout(500)
  100 | 
  101 |     // Look for any service metadata visible on the page
  102 |     const metadata = page.locator('text=Team')
  103 |       .or(page.locator('text=Oncall'))
  104 |       .or(page.locator('text=Repo'))
  105 |       .or(page.locator('text=Owner'))
  106 |       .or(page.locator('text=Language'))
  107 |       .or(page.locator('text=Version'))
  108 |       .first()
  109 |     const visible = await metadata.isVisible({ timeout: 5000 }).catch(() => false)
  110 | 
  111 |     if (!visible) {
  112 |       // Try clicking a service item to reveal detail panel
  113 |       const item = page.locator('text=payments')
  114 |         .or(page.locator('text=auth'))
  115 |         .or(page.locator('text=checkout'))
  116 |         .first()
  117 |       const found = await item.isVisible({ timeout: 2000 }).catch(() => false)
  118 |       if (found) {
  119 |         await item.click()
  120 |         await page.waitForTimeout(300)
  121 |       }
  122 |     }
  123 |     // At minimum, page loaded without crashing
  124 |     await expect(page.locator('body')).toBeVisible()
  125 |   })
  126 | })
  127 | 
```