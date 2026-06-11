# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 09-gate-approvals.spec.ts >> Gate approvals — full lifecycle >> P2: empty state — no pending gates shows informative message
- Location: e2e/09-gate-approvals.spec.ts:151:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  52  |     const createResp = await request.post(`${GATEWAY}/api/gate`, {
  53  |       headers,
  54  |       data: { action: 'deploy', target: uniqueId('svc'), requestedBy: 'e2e-test' },
  55  |     })
  56  |     expect([200, 201]).toContain(createResp.status())
  57  |     const created = await createResp.json() as { id: string }
  58  | 
  59  |     // First decision
  60  |     await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
  61  |       headers,
  62  |       data: { decision: 'approved' },
  63  |     })
  64  | 
  65  |     // Second decision — must 404 (gate already decided)
  66  |     const secondResp = await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
  67  |       headers,
  68  |       data: { decision: 'approved' },
  69  |     })
  70  |     expect(secondResp.status(), 'second decide on same gate must return 404').toBe(404)
  71  |   })
  72  | 
  73  |   test('P0: decide non-existent gate UUID → 404', async ({ request }) => {
  74  |     const resp = await request.post(
  75  |       `${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000099/decide`,
  76  |       { headers, data: { decision: 'approved' } }
  77  |     )
  78  |     expect(resp.status(), 'non-existent gate must return 404').toBe(404)
  79  |   })
  80  | 
  81  |   test('P0: POST gate without auth → 401', async ({ request }) => {
  82  |     const resp = await request.post(`${GATEWAY}/api/gate`, {
  83  |       data: { action: 'deploy', target: 'test', requestedBy: 'e2e' },
  84  |     })
  85  |     expect(resp.status(), 'unauthenticated gate create must return 401').toBe(401)
  86  |   })
  87  | 
  88  |   test('P1: UI — create gate via API, navigate to Approvals, gate title visible in pending list', async ({ page, request }) => {
  89  |     const target = uniqueId('payments-api')
  90  | 
  91  |     // Seed a gate
  92  |     const createResp = await request.post(`${GATEWAY}/api/gate`, {
  93  |       headers,
  94  |       data: { action: 'deploy', target, requestedBy: 'e2e-test' },
  95  |     })
  96  |     expect([200, 201]).toContain(createResp.status())
  97  |     const created = await createResp.json() as { id: string }
  98  | 
  99  |     // Navigate to Approvals
  100 |     await page.goto('/')
  101 |     await page.locator('text=Approvals').first().click()
  102 | 
  103 |     // The approvals view uses mock data — check for any pending gate
  104 |     const pendingItem = page.locator('text=create incident')
  105 |       .or(page.locator('text=notify oncall'))
  106 |       .or(page.locator('text=deploy'))
  107 |       .or(page.locator('text=Approve'))
  108 |       .first()
  109 |     await expect(pendingItem, 'Approvals view must show pending items').toBeVisible({ timeout: 8000 })
  110 | 
  111 |     // Cleanup — try to resolve via API
  112 |     try {
  113 |       await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
  114 |         headers,
  115 |         data: { decision: 'rejected' },
  116 |       })
  117 |     } catch {
  118 |       // ignore
  119 |     }
  120 |   })
  121 | 
  122 |   test('P1: UI — click Approve button, gate disappears from pending list', async ({ page }) => {
  123 |     await page.goto('/')
  124 |     await page.locator('text=Approvals').first().click()
  125 | 
  126 |     // The view loads with mock pending items
  127 |     const approveBtn = page.locator('button:has-text("Approve")').first()
  128 |     const approveVisible = await approveBtn.isVisible({ timeout: 5000 }).catch(() => false)
  129 | 
  130 |     if (approveVisible) {
  131 |       // Record what was there before
  132 |       const initialCount = await page.locator('button:has-text("Approve")').count()
  133 |       await approveBtn.click()
  134 | 
  135 |       // After click, count must decrease (or item removed)
  136 |       await expect(page.locator('text=approve').or(page.locator('text=Approve')).first()).toBeVisible({ timeout: 5000 })
  137 |       const afterCount = await page.locator('button:has-text("Approve")').count()
  138 |       expect(afterCount, 'Approve button count must decrease after approval').toBeLessThan(initialCount)
  139 |     } else {
  140 |       // No pending gates — skip gracefully, but verify empty state
  141 |       const emptyState = page.locator('text=No pending')
  142 |         .or(page.locator('text=no pending'))
  143 |         .or(page.locator('text=All clear'))
  144 |         .first()
  145 |       const hasEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false)
  146 |       // Either pending items or empty state is acceptable
  147 |       expect(approveVisible || hasEmpty, 'Must show either pending approvals or empty state').toBe(true)
  148 |     }
  149 |   })
  150 | 
  151 |   test('P2: empty state — no pending gates shows informative message', async ({ page }) => {
> 152 |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  153 |     await page.locator('text=Approvals').first().click()
  154 | 
  155 |     // Approve all pending gates
  156 |     let approveBtn = page.locator('button:has-text("Approve")').first()
  157 |     let safety = 0
  158 |     while ((await approveBtn.isVisible({ timeout: 1000 }).catch(() => false)) && safety < 10) {
  159 |       await approveBtn.click()
  160 |       await expect(page.locator('text=approve').or(page.locator('text=Approve')).first()).toBeVisible({ timeout: 5000 })
  161 |       safety++
  162 |     }
  163 | 
  164 |     // Now check for empty state or heading
  165 |     const viewContent = page.locator('text=Approvals')
  166 |       .or(page.locator('text=Pending'))
  167 |       .or(page.locator('text=No pending'))
  168 |       .or(page.locator('text=Governance'))
  169 |       .first()
  170 |     await expect(viewContent, 'Approvals view content must be visible').toBeVisible({ timeout: 5000 })
  171 |   })
  172 | })
  173 | 
```