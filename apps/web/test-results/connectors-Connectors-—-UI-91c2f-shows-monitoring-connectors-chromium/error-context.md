# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: connectors.spec.ts >> Connectors — UI >> P1: Observability category filter shows monitoring connectors
- Location: e2e/connectors.spec.ts:76:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | import { GATEWAY, authHeaders } from './fixtures'
  3  | 
  4  | test.describe('Connectors — API', () => {
  5  |   let headers: Record<string, string>
  6  |   test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })
  7  | 
  8  |   test('P0: GET /api/connectors returns 200 array with id/name/type/mode', async ({ request }) => {
  9  |     const resp = await request.get(`${GATEWAY}/api/connectors`, { headers })
  10 |     expect(resp.status()).toBe(200)
  11 |     const body = await resp.json() as Array<{ id: string; name: string; type: string; mode: string }>
  12 |     expect(Array.isArray(body)).toBe(true)
  13 |     for (const c of body) {
  14 |       expect(c.id).toBeDefined()
  15 |       expect(c.name).toBeDefined()
  16 |       expect(c.type).toBeDefined()
  17 |       expect(c.mode).toBeDefined()
  18 |     }
  19 |   })
  20 | 
  21 |   test('P0: GET /api/connectors response has no credentials field', async ({ request }) => {
  22 |     const resp = await request.get(`${GATEWAY}/api/connectors`, { headers })
  23 |     const text = await resp.text()
  24 |     expect(text).not.toMatch(/"credentials"\s*:/)
  25 |   })
  26 | 
  27 |   test('P0: PUT /api/settings/connectors/github registers connector', async ({ request }) => {
  28 |     const resp = await request.put(`${GATEWAY}/api/settings/connectors/github`, {
  29 |       headers, data: { credentials: { token: 'ghp_e2etest', org: 'e2e-org' } },
  30 |     })
  31 |     expect(resp.status()).toBe(200)
  32 |     expect((await resp.json() as { ok: boolean }).ok).toBe(true)
  33 |   })
  34 | 
  35 |   test('P0: PUT /api/settings/connectors/unknown-type returns 400', async ({ request }) => {
  36 |     const resp = await request.put(`${GATEWAY}/api/settings/connectors/nonexistent-xyz`, {
  37 |       headers, data: { credentials: {} },
  38 |     })
  39 |     expect(resp.status()).toBe(400)
  40 |   })
  41 | 
  42 |   test('P1: GET /api/settings/connectors returns array with no credentials', async ({ request }) => {
  43 |     const resp = await request.get(`${GATEWAY}/api/settings/connectors`, { headers })
  44 |     expect(resp.status()).toBe(200)
  45 |     const body = await resp.json() as unknown[]
  46 |     expect(Array.isArray(body)).toBe(true)
  47 |     expect(JSON.stringify(body)).not.toMatch(/"credentials"\s*:/)
  48 |   })
  49 | 
  50 |   test('P1: GET /api/connectors/:type/bootstrap-status returns bootstrapped field', async ({ request }) => {
  51 |     const resp = await request.get(`${GATEWAY}/api/connectors/github/bootstrap-status`, { headers })
  52 |     expect(resp.status()).toBe(200)
  53 |     expect(typeof (await resp.json() as { bootstrapped: boolean }).bootstrapped).toBe('boolean')
  54 |   })
  55 | 
  56 |   test('P1: POST /api/connectors/github/bootstrap returns ok', async ({ request }) => {
  57 |     const resp = await request.post(`${GATEWAY}/api/connectors/github/bootstrap`, { headers })
  58 |     expect(resp.status()).toBe(200)
  59 |     expect((await resp.json() as { ok: boolean }).ok).toBe(true)
  60 |   })
  61 | 
  62 |   test('P1: POST /api/connectors/unknown/bootstrap returns 400', async ({ request }) => {
  63 |     const resp = await request.post(`${GATEWAY}/api/connectors/unknown-xyz/bootstrap`, { headers })
  64 |     expect(resp.status()).toBe(400)
  65 |   })
  66 | })
  67 | 
  68 | test.describe('Connectors — UI', () => {
  69 |   test('P0: navigate to Connectors — GitHub and Datadog cards visible', async ({ page }) => {
  70 |     await page.goto('/')
  71 |     await page.locator('text=Connectors').first().click()
  72 |     await expect(page.locator('text=GitHub').first()).toBeVisible({ timeout: 8000 })
  73 |     await expect(page.locator('text=Datadog').first()).toBeVisible({ timeout: 5000 })
  74 |   })
  75 | 
  76 |   test('P1: Observability category filter shows monitoring connectors', async ({ page }) => {
> 77 |     await page.goto('/')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  78 |     await page.locator('text=Connectors').first().click()
  79 |     await page.locator('text=GitHub').first().waitFor({ timeout: 8000 })
  80 |     const obsBtn = page.locator('button:has-text("Observability")').first()
  81 |     if (await obsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  82 |       await obsBtn.click()
  83 |       await expect(page.locator('text=Prometheus').or(page.locator('text=Datadog')).first()).toBeVisible({ timeout: 3000 })
  84 |     }
  85 |   })
  86 | })
  87 | 
```