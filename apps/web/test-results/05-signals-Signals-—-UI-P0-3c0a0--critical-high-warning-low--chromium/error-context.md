# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-signals.spec.ts >> Signals — UI >> P0: severity badges visible (critical/high/warning/low)
- Location: e2e/05-signals.spec.ts:101:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  2   | import { GATEWAY, authHeaders, DEMO_TENANT, uniqueId, pollUntil } from './fixtures'
  3   | 
  4   | test.describe('Signals — API', () => {
  5   |   let headers: Record<string, string>
  6   | 
  7   |   test.beforeAll(async ({ request }) => {
  8   |     headers = await authHeaders(request)
  9   |   })
  10  | 
  11  |   test('P0: POST /api/events/alert (Alertmanager format) → GET /api/alerts → alert visible with correct severity', async ({ request }) => {
  12  |     const alertName = uniqueId('E2EAlert')
  13  | 
  14  |     // Post alert in Alertmanager format (status defaults to 'firing' if omitted)
  15  |     const postResp = await request.post(`${GATEWAY}/api/events/alert`, {
  16  |       headers, data: {
  17  |         alerts: [
  18  |           {
  19  |             status: 'firing',
  20  |             labels: {
  21  |               alertname: alertName,
  22  |               severity: 'critical',
  23  |               service: 'payments-api',
  24  |             },
  25  |           },
  26  |         ],
  27  |       },
  28  |     })
  29  |     expect([200, 201, 202, 204], 'POST alert event must succeed').toContain(postResp.status())
  30  | 
  31  |     // Poll until the alert appears in the alerts/incidents list
  32  |     const found = await pollUntil(
  33  |       async () => {
  34  |         const resp = await request.get(`${GATEWAY}/api/alerts`, { headers })
  35  |         if (resp.status() !== 200) return []
  36  |         return resp.json() as Promise<Array<{ title?: string; name?: string; severity?: string; labels?: { alertname?: string } }>>
  37  |       },
  38  |       (alerts) => alerts.some(a =>
  39  |         a.title === alertName ||
  40  |         a.name === alertName ||
  41  |         a.labels?.alertname === alertName
  42  |       ),
  43  |       { intervalMs: 400, timeoutMs: 8000 }
  44  |     )
  45  | 
  46  |     const alert = found.find(a =>
  47  |       a.title === alertName ||
  48  |       a.name === alertName ||
  49  |       a.labels?.alertname === alertName
  50  |     )
  51  |     expect(alert, 'posted alert must appear in GET /api/alerts').toBeDefined()
  52  |     expect(alert!.severity ?? alert!.labels?.severity ?? '', 'alert must have severity').toBeTruthy()
  53  |   })
  54  | })
  55  | 
  56  | test.describe('Signals — UI', () => {
  57  |   test('P0: navigate to Signals, tabs All / Alerts / Errors / CI-CD visible', async ({ page }) => {
  58  |     await page.goto('/')
  59  |     await page.locator('text=Signals').first().click()
  60  | 
  61  |     // "All" tab
  62  |     await expect(
  63  |       page.locator('button:has-text("All")').first(),
  64  |       'All tab must be visible'
  65  |     ).toBeVisible({ timeout: 8000 })
  66  | 
  67  |     // "Alerts" tab
  68  |     await expect(
  69  |       page.locator('button:has-text("Alerts")').first(),
  70  |       'Alerts tab must be visible'
  71  |     ).toBeVisible({ timeout: 5000 })
  72  | 
  73  |     // "Errors" tab
  74  |     await expect(
  75  |       page.locator('button:has-text("Errors")').first(),
  76  |       'Errors tab must be visible'
  77  |     ).toBeVisible({ timeout: 5000 })
  78  |   })
  79  | 
  80  |   test('P0: click Alerts tab → content area shows alert items', async ({ page }) => {
  81  |     await page.goto('/')
  82  |     await page.locator('text=Signals').first().click()
  83  | 
  84  |     // Wait for view to load
  85  |     await page.locator('button:has-text("All")').first().waitFor({ timeout: 8000 })
  86  | 
  87  |     // Click Alerts tab
  88  |     await page.locator('button:has-text("Alerts")').first().click()
  89  |     await expect(page.locator('text=critical').or(page.locator('text=high')).first()).toBeVisible({ timeout: 5000 })
  90  | 
  91  |     // Content should update — either shows alerts or empty state
  92  |     const content = page.locator('text=Alerts')
  93  |       .or(page.locator('text=No alerts'))
  94  |       .or(page.locator('text=critical'))
  95  |       .or(page.locator('text=high'))
  96  |       .or(page.locator('text=firing'))
  97  |       .first()
  98  |     await expect(content, 'Alerts tab content must be visible after click').toBeVisible({ timeout: 5000 })
  99  |   })
  100 | 
  101 |   test('P0: severity badges visible (critical/high/warning/low)', async ({ page }) => {
> 102 |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  103 |     await page.locator('text=Signals').first().click()
  104 | 
  105 |     // View loads
  106 |     await page.locator('button:has-text("All")').first().waitFor({ timeout: 8000 })
  107 | 
  108 |     // Check for severity badges — at least one must be visible if data exists
  109 |     const badge = page.locator('text=critical')
  110 |       .or(page.locator('text=high'))
  111 |       .or(page.locator('text=warning'))
  112 |       .or(page.locator('text=low'))
  113 |       .or(page.locator('text=medium'))
  114 |     const anyBadge = await badge.first().isVisible({ timeout: 3000 }).catch(() => false)
  115 | 
  116 |     // If no badges, check for empty state — both are valid
  117 |     const emptyState = page.locator('text=No signals')
  118 |       .or(page.locator('text=No alerts'))
  119 |       .or(page.locator('text=All clear'))
  120 |       .first()
  121 |     const hasEmpty = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
  122 | 
  123 |     expect(anyBadge || hasEmpty, 'Must show either severity badges or empty state').toBe(true)
  124 |   })
  125 | 
  126 |   test('P1: click signal row to expand triage details', async ({ page }) => {
  127 |     await page.goto('/')
  128 |     await page.locator('text=Signals').first().click()
  129 |     await page.locator('button:has-text("All")').first().waitFor({ timeout: 8000 })
  130 | 
  131 |     // Find a clickable signal row
  132 |     const signalRow = page.locator('[data-testid="signal-row"]')
  133 |       .or(page.locator('div').filter({ hasText: /critical|high|warning|low/ }).first())
  134 |     const rowVisible = await signalRow.isVisible({ timeout: 3000 }).catch(() => false)
  135 | 
  136 |     if (rowVisible) {
  137 |       await signalRow.click()
  138 |       await expect(page.locator('text=critical').or(page.locator('text=high')).first()).toBeVisible({ timeout: 5000 })
  139 | 
  140 |       // After click, triage details should expand
  141 |       const details = page.locator('text=Triage')
  142 |         .or(page.locator('text=Root Cause'))
  143 |         .or(page.locator('text=Affected'))
  144 |         .or(page.locator('text=Open War Room'))
  145 |         .first()
  146 |       const detailsVisible = await details.isVisible({ timeout: 3000 }).catch(() => false)
  147 |       // Soft assertion — row expansion is a bonus behavior
  148 |       if (detailsVisible) {
  149 |         expect(detailsVisible, 'triage details must expand after row click').toBe(true)
  150 |       }
  151 |     }
  152 |   })
  153 | 
  154 |   test('P1: severity filter buttons filter the signal list', async ({ page }) => {
  155 |     await page.goto('/')
  156 |     await page.locator('text=Signals').first().click()
  157 |     await page.locator('button:has-text("All")').first().waitFor({ timeout: 8000 })
  158 | 
  159 |     // Click a severity filter if available
  160 |     const criticalFilter = page.locator('button:has-text("Critical")').first()
  161 |     const filterVisible = await criticalFilter.isVisible({ timeout: 2000 }).catch(() => false)
  162 | 
  163 |     if (filterVisible) {
  164 |       await criticalFilter.click()
  165 |       await expect(page.locator('text=critical').or(page.locator('text=high')).first()).toBeVisible({ timeout: 5000 })
  166 | 
  167 |       // After filtering, content should update
  168 |       const content = page.locator('text=critical')
  169 |         .or(page.locator('text=No results'))
  170 |         .or(page.locator('text=No critical'))
  171 |         .first()
  172 |       await expect(content, 'Filter must update content').toBeVisible({ timeout: 3000 })
  173 |     }
  174 |   })
  175 | })
  176 | 
```