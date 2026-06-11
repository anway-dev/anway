# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 04-incidents.spec.ts >> Incidents — full lifecycle >> P1: severity badge colors visible in War Room UI
- Location: e2e/04-incidents.spec.ts:143:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  44  |     const getResp = await request.get(`${GATEWAY}/api/incidents/${created.id}`, { headers })
  45  |     expect(getResp.status()).toBe(200)
  46  |     const fetched = await getResp.json() as { id: string; title: string; status: string }
  47  |     expect(fetched.title).toBe(title)
  48  |     expect(['active', 'investigating'], `initial status must be active or investigating`).toContain(fetched.status)
  49  | 
  50  |     // Step 4: resolve
  51  |     const resolveResp = await request.post(`${GATEWAY}/api/incidents/${created.id}/resolve`, { headers })
  52  |     expect(resolveResp.status()).toBe(200)
  53  |     const resolveBody = await resolveResp.json() as { ok: boolean }
  54  |     expect(resolveBody.ok).toBe(true)
  55  | 
  56  |     // Step 5: GET by id — status resolved
  57  |     const afterResolve = await request.get(`${GATEWAY}/api/incidents/${created.id}`, { headers })
  58  |     expect(afterResolve.status()).toBe(200)
  59  |     const resolvedIncident = await afterResolve.json() as { status: string }
  60  |     expect(resolvedIncident.status, 'status must be resolved after resolve call').toBe('resolved')
  61  | 
  62  |     // Step 6: must NOT appear in active filter
  63  |     const activeListResp = await request.get(`${GATEWAY}/api/incidents?status=active`, { headers })
  64  |     if (activeListResp.status() === 200) {
  65  |       const activeList = await activeListResp.json() as Array<{ id: string }>
  66  |       expect(
  67  |         activeList.some(i => i.id === created.id),
  68  |         'resolved incident must not appear in active filter'
  69  |       ).toBe(false)
  70  |     }
  71  |   })
  72  | 
  73  |   test('P0: create with missing title returns 400', async ({ request }) => {
  74  |     const resp = await request.post(`${GATEWAY}/api/incidents`, {
  75  |       headers,
  76  |       data: { severity: 'high' },
  77  |     })
  78  |     expect(resp.status(), 'missing title must return 400').toBe(400)
  79  |   })
  80  | 
  81  |   test('P0: create with invalid severity returns 400', async ({ request }) => {
  82  |     const resp = await request.post(`${GATEWAY}/api/incidents`, {
  83  |       headers,
  84  |       data: { title: 'E2E-bad-severity', severity: 'super-critical' },
  85  |     })
  86  |     expect(resp.status(), 'invalid severity must return 400').toBe(400)
  87  |   })
  88  | 
  89  |   test('P0: GET non-existent UUID returns 404', async ({ request }) => {
  90  |     const resp = await request.get(
  91  |       `${GATEWAY}/api/incidents/00000000-0000-0000-0000-000000000099`,
  92  |       { headers }
  93  |     )
  94  |     expect(resp.status(), 'non-existent incident must return 404').toBe(404)
  95  |   })
  96  | 
  97  |   test('P1: filter by status=active returns only active incidents', async ({ request }) => {
  98  |     const title = uniqueId('E2E-active-filter')
  99  |     const createResp = await request.post(`${GATEWAY}/api/incidents`, {
  100 |       headers,
  101 |       data: { title, severity: 'medium' },
  102 |     })
  103 |     expect([200, 201]).toContain(createResp.status())
  104 |     const created = await createResp.json() as { id: string }
  105 |     createdIds.push(created.id)
  106 | 
  107 |     const listResp = await request.get(`${GATEWAY}/api/incidents?status=active`, { headers })
  108 |     if (listResp.status() === 200) {
  109 |       const list = await listResp.json() as Array<{ id: string; status: string }>
  110 |       for (const inc of list) {
  111 |         expect(
  112 |           ['active', 'investigating'],
  113 |           `all incidents in active filter must be active or investigating`
  114 |         ).toContain(inc.status)
  115 |       }
  116 |     }
  117 |   })
  118 | 
  119 |   test('P1: filter by status=resolved returns only resolved incidents', async ({ request }) => {
  120 |     const title = uniqueId('E2E-resolve-filter')
  121 |     const createResp = await request.post(`${GATEWAY}/api/incidents`, {
  122 |       headers,
  123 |       data: { title, severity: 'low' },
  124 |     })
  125 |     expect([200, 201]).toContain(createResp.status())
  126 |     const created = await createResp.json() as { id: string }
  127 |     createdIds.push(created.id)
  128 | 
  129 |     await request.post(`${GATEWAY}/api/incidents/${created.id}/resolve`, { headers })
  130 | 
  131 |     const listResp = await request.get(`${GATEWAY}/api/incidents?status=resolved`, { headers })
  132 |     if (listResp.status() === 200) {
  133 |       const list = await listResp.json() as Array<{ id: string; status: string }>
  134 |       for (const inc of list) {
  135 |         expect(
  136 |           inc.status,
  137 |           `all incidents in resolved filter must have status=resolved`
  138 |         ).toBe('resolved')
  139 |       }
  140 |     }
  141 |   })
  142 | 
  143 |   test('P1: severity badge colors visible in War Room UI', async ({ page }) => {
> 144 |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  145 |     await page.locator('text=War Room').first().click()
  146 |     // Verify incident severity labels are visible — critical/high/medium/low
  147 |     const severityLabel = page.locator('text=critical')
  148 |       .or(page.locator('text=high'))
  149 |       .or(page.locator('text=medium'))
  150 |       .or(page.locator('text=low'))
  151 |       .first()
  152 |     // It's OK if no incidents exist — just check the view loaded
  153 |     const viewLoaded = await page.locator('text=War Room')
  154 |       .or(page.locator('text=Incident'))
  155 |       .or(page.locator('text=No active incidents'))
  156 |       .first()
  157 |       .isVisible({ timeout: 8000 })
  158 |       .catch(() => false)
  159 |     expect(viewLoaded, 'War Room view must load').toBe(true)
  160 |   })
  161 | })
  162 | 
```