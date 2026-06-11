# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: anvay.spec.ts >> I extended: Web UI navigation >> I.nav Connectors loads without JS errors
- Location: e2e/anvay.spec.ts:410:9

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "networkidle"

```

# Test source

```ts
  313 | 
  314 |   test('D.7 POST /api/incidents/:id/resolve returns ok', async ({ request }) => {
  315 |     const resp = await request.post(`${GATEWAY}/api/incidents/${incidentId}/resolve`, {
  316 |       headers: { Authorization: `Bearer ${token}` },
  317 |     })
  318 |     expect(resp.status()).toBe(200)
  319 |     const body = await resp.json()
  320 |     expect(body.ok).toBe(true)
  321 |   })
  322 | })
  323 | 
  324 | // ---------------------------------------------------------------------------
  325 | // Suite F extended — Trigger CRUD
  326 | // ---------------------------------------------------------------------------
  327 | test.describe('F extended: Trigger CRUD', () => {
  328 |   let token: string
  329 |   let triggerId: string
  330 | 
  331 |   test.beforeAll(async ({ request }) => {
  332 |     token = await getToken(request)
  333 |   })
  334 | 
  335 |   test('F.3 POST /api/automations/triggers creates trigger', async ({ request }) => {
  336 |     const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
  337 |       headers: { Authorization: `Bearer ${token}` },
  338 |       data: { eventType: 'alert_fired', condition: {}, actions: [{ type: 'notify_oncall', target: 'oncall' }] },
  339 |     })
  340 |     expect(resp.status()).toBe(200)
  341 |     const body = await resp.json()
  342 |     const created = Array.isArray(body) ? body[0] : body
  343 |     expect(created.id).toBeDefined()
  344 |     triggerId = created.id
  345 |   })
  346 | 
  347 |   test('F.4 GET /api/automations/triggers includes new trigger', async ({ request }) => {
  348 |     const resp = await request.get(`${GATEWAY}/api/automations/triggers`, {
  349 |       headers: { Authorization: `Bearer ${token}` },
  350 |     })
  351 |     expect(resp.status()).toBe(200)
  352 |     const body = await resp.json() as Array<{ id: string }>
  353 |     expect(body.some(t => t.id === triggerId)).toBe(true)
  354 |   })
  355 | 
  356 |   test('F.5 DELETE /api/automations/triggers/:id removes trigger', async ({ request }) => {
  357 |     const resp = await request.delete(`${GATEWAY}/api/automations/triggers/${triggerId}`, {
  358 |       headers: { Authorization: `Bearer ${token}` },
  359 |     })
  360 |     expect([200, 204]).toContain(resp.status())
  361 |     const list = await request.get(`${GATEWAY}/api/automations/triggers`, {
  362 |       headers: { Authorization: `Bearer ${token}` },
  363 |     })
  364 |     const body = await list.json() as Array<{ id: string }>
  365 |     expect(body.some(t => t.id === triggerId)).toBe(false)
  366 |   })
  367 | })
  368 | 
  369 | // ---------------------------------------------------------------------------
  370 | // Suite H extended — Chat input validation
  371 | // ---------------------------------------------------------------------------
  372 | test.describe('H extended: Chat validation', () => {
  373 |   let token: string
  374 | 
  375 |   test.beforeAll(async ({ request }) => {
  376 |     token = await getToken(request)
  377 |   })
  378 | 
  379 |   test('H.2 POST /api/chat missing query returns 400', async ({ request }) => {
  380 |     const resp = await request.post(`${GATEWAY}/api/chat`, {
  381 |       headers: { Authorization: `Bearer ${token}` },
  382 |       data: { sessionId: 'test-session' },
  383 |     })
  384 |     expect(resp.status()).toBe(400)
  385 |   })
  386 | 
  387 |   test('H.3 POST /api/chat missing sessionId returns 400', async ({ request }) => {
  388 |     const resp = await request.post(`${GATEWAY}/api/chat`, {
  389 |       headers: { Authorization: `Bearer ${token}` },
  390 |       data: { query: 'hello' },
  391 |     })
  392 |     expect(resp.status()).toBe(400)
  393 |   })
  394 | })
  395 | 
  396 | // ---------------------------------------------------------------------------
  397 | // Suite I extended — Web UI navigation
  398 | // ---------------------------------------------------------------------------
  399 | test.describe('I extended: Web UI navigation', () => {
  400 |   const navItems = [
  401 |     { label: 'War Room', text: 'War Room' },
  402 |     { label: 'Services', text: 'Services' },
  403 |     { label: 'Workflows', text: 'Workflows' },
  404 |     { label: 'Automations', text: 'Automations' },
  405 |     { label: 'Connectors', text: 'Connectors' },
  406 |     { label: 'Audit', text: 'Audit' },
  407 |   ]
  408 | 
  409 |   for (const view of navItems) {
  410 |     test(`I.nav ${view.label} loads without JS errors`, async ({ page }) => {
  411 |       const errors: string[] = []
  412 |       page.on('pageerror', e => errors.push(e.message))
> 413 |       await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60_000 })
      |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  414 |       await page.locator(`text=${view.text}`).first().click({ timeout: 15_000 })
  415 |       await page.waitForTimeout(1000)
  416 |       expect(errors).toHaveLength(0)
  417 |     })
  418 |   }
  419 | })
  420 | 
  421 | // ---------------------------------------------------------------------------
  422 | // P0 — Incidents CRUD
  423 | // ---------------------------------------------------------------------------
  424 | test.describe('P0: Incidents CRUD', () => {
  425 |   let token: string
  426 |   let headers: Record<string, string>
  427 | 
  428 |   test.beforeAll(async ({ request }) => {
  429 |     headers = await authHeaders(request)
  430 |     token = headers.authorization?.replace('Bearer ', '') ?? ''
  431 |   })
  432 | 
  433 |   test('P0-3.1: Create incident — full roundtrip', async ({ request }) => {
  434 |     const title = `E2E-test-${Date.now()}`
  435 |     const resp = await request.post(`${GATEWAY}/api/incidents`, {
  436 |       headers: { ...headers, 'Content-Type': 'application/json' },
  437 |       data: { title, severity: 'high', description: 'E2E test incident' },
  438 |     })
  439 |     expect([200, 201]).toContain(resp.status())
  440 |     const body = await resp.json() as { id: string; title: string; severity: string }
  441 |     expect(body.id).toBeTruthy()
  442 |     expect(body.title).toBe(title)
  443 |     expect(body.severity).toBe('high')
  444 | 
  445 |     // GET the incident
  446 |     const getResp = await request.get(`${GATEWAY}/api/incidents/${body.id}`, { headers })
  447 |     expect(getResp.status()).toBe(200)
  448 |     const got = await getResp.json() as { title: string }
  449 |     expect(got.title).toBe(title)
  450 |   })
  451 | 
  452 |   test('P0-3.2: Create incident — validation', async ({ request }) => {
  453 |     const resp = await request.post(`${GATEWAY}/api/incidents`, {
  454 |       headers: { ...headers, 'Content-Type': 'application/json' },
  455 |       data: { severity: 'high' },
  456 |     })
  457 |     expect(resp.status()).toBe(400)
  458 |   })
  459 | 
  460 |   test('P0-3.3: Resolve incident', async ({ request }) => {
  461 |     const title = `E2E-resolve-${Date.now()}`
  462 |     const createResp = await request.post(`${GATEWAY}/api/incidents`, {
  463 |       headers: { ...headers, 'Content-Type': 'application/json' },
  464 |       data: { title, severity: 'medium' },
  465 |     })
  466 |     const { id } = await createResp.json() as { id: string }
  467 | 
  468 |     const resolveResp = await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers })
  469 |     expect(resolveResp.status()).toBe(200)
  470 |     const result = await resolveResp.json() as { ok: boolean }
  471 |     expect(result.ok).toBe(true)
  472 | 
  473 |     // Verify status changed
  474 |     const getResp = await request.get(`${GATEWAY}/api/incidents/${id}`, { headers })
  475 |     const got = await getResp.json() as { status: string }
  476 |     expect(got.status).toBe('resolved')
  477 |   })
  478 | 
  479 |   test('P0-3.4: Get non-existent incident', async ({ request }) => {
  480 |     const resp = await request.get(`${GATEWAY}/api/incidents/00000000-0000-0000-0000-000000000099`, { headers })
  481 |     expect(resp.status()).toBe(404)
  482 |   })
  483 | })
  484 | 
```