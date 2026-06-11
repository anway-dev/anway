# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 08-automations.spec.ts >> Automations — trigger lifecycle >> P1: UI — Automations view has Triggers and Monitors tabs
- Location: e2e/08-automations.spec.ts:112:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  13  |     for (const id of createdTriggerIds) {
  14  |       try {
  15  |         await request.delete(`${GATEWAY}/api/automations/triggers/${id}`, { headers })
  16  |       } catch {
  17  |         // best-effort cleanup
  18  |       }
  19  |     }
  20  |     createdTriggerIds = []
  21  |   })
  22  | 
  23  |   test('P0: POST trigger → GET list → PATCH disable → GET confirms disabled → DELETE → not in list', async ({ request }) => {
  24  |     // Step 1: create trigger
  25  |     const createResp = await request.post(`${GATEWAY}/api/automations/triggers`, {
  26  |       headers,
  27  |       data: {
  28  |         eventType: 'alert_fired',
  29  |         condition: { severity: 'critical' },
  30  |         actions: [{ type: 'notify_oncall', params: { target: 'oncall' } }],
  31  |       },
  32  |     })
  33  |     expect(createResp.status(), 'POST trigger must succeed').toBe(200)
  34  |     const createBody = await createResp.json()
  35  |     const created = Array.isArray(createBody) ? createBody[0] : createBody
  36  |     expect(created.id, 'created trigger must have an id').toBeDefined()
  37  |     createdTriggerIds.push(created.id)
  38  | 
  39  |     // Step 2: GET list — trigger in list with correct fields
  40  |     const listResp = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
  41  |     expect(listResp.status()).toBe(200)
  42  |     const list = await listResp.json() as Array<{ id: string; eventType: string; enabled: boolean }>
  43  |     const found = list.find(t => t.id === created.id)
  44  |     expect(found, `trigger ${created.id} must appear in list`).toBeDefined()
  45  |     expect(found!.eventType, 'eventType must be alert_fired').toBe('alert_fired')
  46  | 
  47  |     // Step 3: PATCH to disable (gateway may accept or reject)
  48  |     const patchResp = await request.patch(`${GATEWAY}/api/automations/triggers/${created.id}`, {
  49  |       headers,
  50  |       data: { enabled: false },
  51  |     })
  52  |     expect([200, 201, 204], 'PATCH trigger must succeed').toContain(patchResp.status())
  53  | 
  54  |     // Step 4: GET list — trigger is still present (may or may not have enabled field)
  55  |     const listAfterPatch = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
  56  |     expect(listAfterPatch.status()).toBe(200)
  57  |     const listData = await listAfterPatch.json() as Array<{ id: string; enabled?: boolean }>
  58  |     const disabledTrigger = listData.find(t => t.id === created.id)
  59  |     // Trigger may be deleted by PATCH instead of disabled — both behaviors acceptable for now
  60  |     if (disabledTrigger) {
  61  |       expect(disabledTrigger.enabled, 'if trigger persists, must be disabled').toBeFalsy()
  62  |     }
  63  | 
  64  |     // Step 5: DELETE
  65  |     const deleteResp = await request.delete(`${GATEWAY}/api/automations/triggers/${created.id}`, { headers })
  66  |     expect([200, 204], 'DELETE trigger must succeed').toContain(deleteResp.status())
  67  |     createdTriggerIds = createdTriggerIds.filter(id => id !== created.id)
  68  | 
  69  |     // Step 6: GET list — trigger gone
  70  |     const listAfterDelete = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
  71  |     expect(listAfterDelete.status()).toBe(200)
  72  |     const finalList = await listAfterDelete.json() as Array<{ id: string }>
  73  |     expect(
  74  |       finalList.some(t => t.id === created.id),
  75  |       'deleted trigger must not appear in list'
  76  |     ).toBe(false)
  77  |   })
  78  | 
  79  |   test('P0: POST trigger without eventType returns 400', async ({ request }) => {
  80  |     const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
  81  |       headers,
  82  |       data: { actions: [{ type: 'notify_oncall', params: { target: 'oncall' } }] },
  83  |     })
  84  |     expect(resp.status(), 'missing eventType must return 400').toBe(400)
  85  |   })
  86  | 
  87  |   test('P0: POST trigger with empty actions array returns 400', async ({ request }) => {
  88  |     const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
  89  |       headers,
  90  |       data: { eventType: 'alert_fired', actions: [] },
  91  |     })
  92  |     // Schema now enforces minItems: 1 — empty actions must be rejected
  93  |     expect(resp.status(), 'empty actions array must return 400').toBe(400)
  94  |   })
  95  | 
  96  |   test('P1: GET monitors returns array (may be empty)', async ({ request }) => {
  97  |     const resp = await request.get(`${GATEWAY}/api/automations/monitors`, { headers })
  98  |     expect(resp.status(), 'GET monitors must return 200').toBe(200)
  99  |     const body = await resp.json()
  100 |     expect(Array.isArray(body), 'monitors response must be an array').toBe(true)
  101 |   })
  102 | 
  103 |   test('P1: PATCH non-existent trigger returns 404', async ({ request }) => {
  104 |     const resp = await request.patch(
  105 |       `${GATEWAY}/api/automations/triggers/00000000-0000-0000-0000-000000000099`,
  106 |       { headers, data: { enabled: false } }
  107 |     )
  108 |     // PATCH now checks row count — non-existent returns 404
  109 |     expect([404], 'PATCH non-existent trigger must return 404 — now returns row count').toContain(resp.status())
  110 |   })
  111 | 
  112 |   test('P1: UI — Automations view has Triggers and Monitors tabs', async ({ page }) => {
> 113 |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  114 |     await page.locator('text=Automations').first().click()
  115 | 
  116 |     // Triggers tab visible
  117 |     const triggersTab = page.locator('button:has-text("Triggers")').or(page.locator('text=Triggers').first())
  118 |     await expect(triggersTab.first(), 'Triggers tab must be visible').toBeVisible({ timeout: 8000 })
  119 | 
  120 |     // Monitors/Cron tab visible
  121 |     const monitorsTab = page.locator('button:has-text("Monitors")').or(page.locator('button:has-text("Cron")'))
  122 |     await expect(monitorsTab.first(), 'Monitors tab must be visible').toBeVisible({ timeout: 8000 })
  123 |   })
  124 | })
  125 | 
```