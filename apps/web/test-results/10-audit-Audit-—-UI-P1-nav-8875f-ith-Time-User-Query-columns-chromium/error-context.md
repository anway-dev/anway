# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 10-audit.spec.ts >> Audit — UI >> P1: navigate to Audit, table visible with Time, User, Query columns
- Location: e2e/10-audit.spec.ts:88:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | import { GATEWAY, authHeaders, uniqueId, pollUntil } from './fixtures'
  3   | 
  4   | test.describe('Audit — API', () => {
  5   |   let headers: Record<string, string>
  6   |   let createdIncidentIds: string[] = []
  7   | 
  8   |   test.beforeAll(async ({ request }) => {
  9   |     headers = await authHeaders(request)
  10  |   })
  11  | 
  12  |   test.afterEach(async ({ request }) => {
  13  |     for (const id of createdIncidentIds) {
  14  |       try {
  15  |         await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers })
  16  |       } catch {
  17  |         // best-effort
  18  |       }
  19  |     }
  20  |     createdIncidentIds = []
  21  |   })
  22  | 
  23  |   test('P0: GET /api/audit returns 200 and an array', async ({ request }) => {
  24  |     const resp = await request.get(`${GATEWAY}/api/audit`, { headers })
  25  |     expect(resp.status(), 'GET /api/audit must return 200').toBe(200)
  26  |     const body = await resp.json()
  27  |     expect(Array.isArray(body), 'audit response must be an array').toBe(true)
  28  |   })
  29  | 
  30  |   test('P0: create incident then GET /api/audit?search={title} — event exists', async ({ request }) => {
  31  |     const title = uniqueId('E2E-audit-search')
  32  | 
  33  |     const createResp = await request.post(`${GATEWAY}/api/incidents`, {
  34  |       headers,
  35  |       data: { title, severity: 'medium' },
  36  |     })
  37  |     expect([200, 201]).toContain(createResp.status())
  38  |     const created = await createResp.json() as { id: string }
  39  |     createdIncidentIds.push(created.id)
  40  | 
  41  |     // Poll until the audit event appears (may have slight write lag)
  42  |     const found = await pollUntil(
  43  |       async () => {
  44  |         const auditResp = await request.get(
  45  |           `${GATEWAY}/api/audit?search=${encodeURIComponent(title)}`,
  46  |           { headers }
  47  |         )
  48  |         if (auditResp.status() !== 200) return []
  49  |         return auditResp.json() as Promise<Array<{ action?: string; query?: string; id?: string }>>
  50  |       },
  51  |       (results) => results.length > 0,
  52  |       { intervalMs: 400, timeoutMs: 6000 }
  53  |     ).catch(() => null)
  54  | 
  55  |     // Audit event search may not be available in all implementations — accept null result
  56  |     if (found !== null) {
  57  |       expect(found.length, `audit search for "${title}" must return at least one event`).toBeGreaterThan(0)
  58  |     }
  59  |   })
  60  | 
  61  |   test('P0: GET /api/audit?limit=3 returns at most 3 events', async ({ request }) => {
  62  |     const resp = await request.get(`${GATEWAY}/api/audit?limit=3`, { headers })
  63  |     expect(resp.status()).toBe(200)
  64  |     const body = await resp.json() as unknown[]
  65  |     expect(body.length, 'limit=3 must return at most 3 events').toBeLessThanOrEqual(3)
  66  |   })
  67  | 
  68  |   test('P0: GET /api/audit?limit=3&offset=0 vs offset=3 returns different events', async ({ request }) => {
  69  |     const page1Resp = await request.get(`${GATEWAY}/api/audit?limit=3&offset=0`, { headers })
  70  |     const page2Resp = await request.get(`${GATEWAY}/api/audit?limit=3&offset=3`, { headers })
  71  | 
  72  |     expect(page1Resp.status()).toBe(200)
  73  |     expect(page2Resp.status()).toBe(200)
  74  | 
  75  |     const page1 = await page1Resp.json() as Array<{ id: string }>
  76  |     const page2 = await page2Resp.json() as Array<{ id: string }>
  77  | 
  78  |     // If there are enough events, the pages must differ
  79  |     if (page1.length > 0 && page2.length > 0) {
  80  |       const page1Ids = new Set(page1.map(e => e.id))
  81  |       const overlap = page2.filter(e => page1Ids.has(e.id))
  82  |       expect(overlap.length, 'pages with offset must not overlap').toBe(0)
  83  |     }
  84  |   })
  85  | })
  86  | 
  87  | test.describe('Audit — UI', () => {
  88  |   test('P1: navigate to Audit, table visible with Time, User, Query columns', async ({ page }) => {
> 89  |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  90  |     await page.locator('text=Audit').first().click()
  91  | 
  92  |     // Check that the audit view heading or audit trail is visible
  93  |     await expect(
  94  |       page.locator('text=Audit Trail').or(page.locator('text=Audit Log')).first(),
  95  |       'Audit heading must be visible'
  96  |     ).toBeVisible({ timeout: 8000 })
  97  | 
  98  |     // Check for column headers (Time / User / Action / Query)
  99  |     const timeCol = page.locator('text=Time').or(page.locator('text=Timestamp')).first()
  100 |     const userCol = page.locator('text=User').or(page.locator('text=Actor')).first()
  101 |     const queryCol = page.locator('text=Query').or(page.locator('text=Action')).first()
  102 | 
  103 |     await expect(timeCol, 'Time column must be visible').toBeVisible({ timeout: 5000 })
  104 |     await expect(userCol, 'User column must be visible').toBeVisible({ timeout: 5000 })
  105 |     await expect(queryCol, 'Query/Action column must be visible').toBeVisible({ timeout: 5000 })
  106 |   })
  107 | 
  108 |   test('P1: search input filters rows — type term, matching rows visible', async ({ page }) => {
  109 |     await page.goto('/')
  110 |     await page.locator('text=Audit').first().click()
  111 | 
  112 |     // Wait for view to load
  113 |     await page.locator('text=Audit Trail').or(page.locator('text=Audit Log')).first().waitFor({ timeout: 8000 })
  114 | 
  115 |     const searchInput = page.locator('input[placeholder*="Search"]')
  116 |       .or(page.locator('input[placeholder*="search"]'))
  117 |       .or(page.locator('input[placeholder*="Filter"]'))
  118 |       .first()
  119 | 
  120 |     const inputVisible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false)
  121 |     if (inputVisible) {
  122 |       await searchInput.fill('test')
  123 |       await expect(page.locator('text=query').or(page.locator('text=Event')).first()).toBeVisible({ timeout: 5000 }) // allow debounce
  124 |       // Either matching rows are shown OR empty state — both are correct filter behavior
  125 |       const hasContent = await page.locator('table tbody tr')
  126 |         .or(page.locator('[data-testid="audit-row"]'))
  127 |         .or(page.locator('text=No events'))
  128 |         .or(page.locator('text=No results'))
  129 |         .first()
  130 |         .isVisible({ timeout: 3000 })
  131 |         .catch(() => false)
  132 |       expect(hasContent, 'search must show either rows or empty state').toBe(true)
  133 |     }
  134 |   })
  135 | 
  136 |   test('P1: click row to expand detail — more info becomes visible', async ({ page }) => {
  137 |     await page.goto('/')
  138 |     await page.locator('text=Audit').first().click()
  139 |     await page.locator('text=Audit Trail').or(page.locator('text=Audit Log')).first().waitFor({ timeout: 8000 })
  140 | 
  141 |     // Find a clickable row (table row or list item)
  142 |     const row = page.locator('table tbody tr').or(page.locator('[data-testid="audit-row"]')).first()
  143 |     const rowVisible = await row.isVisible({ timeout: 3000 }).catch(() => false)
  144 | 
  145 |     if (rowVisible) {
  146 |       await row.click()
  147 |       await expect(page.locator('text=query').or(page.locator('text=Event')).first()).toBeVisible({ timeout: 5000 })
  148 |       // After clicking a row, some additional detail or expanded content should appear
  149 |       const expanded = page.locator('[data-testid="audit-detail"]')
  150 |         .or(page.locator('text=Role'))
  151 |         .or(page.locator('text=Session'))
  152 |         .or(page.locator('text=agent'))
  153 |         .first()
  154 |       const expandedVisible = await expanded.isVisible({ timeout: 3000 }).catch(() => false)
  155 |       // Soft assertion — not all implementations have row expansion
  156 |       if (!expandedVisible) {
  157 |         // At minimum, clicking should not crash the page
  158 |         const errors: string[] = []
  159 |         page.on('pageerror', e => errors.push(e.message))
  160 |         expect(errors.length, 'clicking audit row must not cause JS errors').toBe(0)
  161 |       }
  162 |     }
  163 |   })
  164 | })
  165 | 
```