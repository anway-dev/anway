/**
 * PROD-READINESS CERTIFICATION SUITE
 *
 * Run via: scripts/certify.sh  (starts demo stack, waits healthy, runs this)
 *
 * Contract: every test here asserts the SUCCESS path against a live demo
 * stack. No `[200, 400, 503]` escape hatches — if a flow is broken the
 * suite fails and the service is NOT certified.
 *
 * Sections:
 *   A. Health        — gateway live + ready
 *   B. Auth          — token issue, gate enforcement
 *   C. LLM provider  — provider configured (product cannot operate without)
 *   D. Connectors    — register, list, bootstrap, bootstrapped_at write-back
 *   E. Graph         — services indexed from demo connectors
 *   F. Alert flow    — Alertmanager webhook → incident in DB → /api/alerts
 *   G. Automations   — trigger CRUD + cron monitor CRUD
 *   H. Audit         — log written, queryable
 *   I. UI            — login, views render real data (no mock fallbacks)
 */
import { test, expect } from '@playwright/test'
import { GATEWAY, WEB, DEMO_TENANT, DEMO_EMAIL, authHeaders, setAuthCookie, pollUntil, uniqueId } from './fixtures'

test.describe.configure({ mode: 'serial' })

let headers: Record<string, string>

test.beforeAll(async ({ request }) => {
  headers = await authHeaders(request)
  expect(headers['Authorization'], 'CERT PRECONDITION: auth token must be obtainable').toBeTruthy()
})

// ---------------------------------------------------------------------------
test.describe('CERT A: Health', () => {
  test('A.1 gateway /health returns 200', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/health`)
    expect(r.status()).toBe(200)
  })

  test('A.2 gateway /health/ready returns 200 — DB + Redis reachable', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/health/ready`)
    expect(r.status(), 'gateway must report ready (Postgres + Redis up)').toBe(200)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT B: Auth', () => {
  test('B.1 POST /auth/token issues JWT for valid tenant', async ({ request }) => {
    const r = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    expect(r.status()).toBe(200)
    const body = await r.json() as { token?: string }
    expect(body.token, 'token must be issued').toBeTruthy()
    expect(body.token!.split('.').length, 'token must be a JWT').toBe(3)
  })

  test('B.2 protected endpoint without token returns 401', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/api/connectors`)
    expect(r.status()).toBe(401)
  })

  test('B.3 protected endpoint with token returns 200', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/api/connectors`, { headers })
    expect(r.status()).toBe(200)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT C: LLM Provider', () => {
  test('C.1 provider configured — required for orchestrator + graph builder', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/api/settings/provider`, { headers })
    expect(r.status()).toBe(200)
    const body = await r.json() as { configured?: boolean; provider?: string }
    expect(
      body.configured,
      'CERT FAIL: no LLM provider configured. Set one in Settings > AI Provider. ' +
      'Graph indexing and chat are dead without it — service is NOT prod ready.'
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT D: Connector lifecycle', () => {
  test('D.1 register prometheus connector (demo stack URL)', async ({ request }) => {
    const r = await request.put(`${GATEWAY}/api/settings/connectors/prometheus`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { credentials: { baseUrl: process.env['DEMO_PROMETHEUS_URL'] ?? 'http://127.0.0.1:9090' } },
    })
    expect(r.status(), 'connector registration must succeed').toBe(200)
  })

  test('D.2 connector listed in settings', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/api/settings/connectors`, { headers })
    expect(r.status()).toBe(200)
    const list = await r.json() as Array<{ connectorType: string; enabled: boolean }>
    const prom = list.find(c => c.connectorType === 'prometheus')
    expect(prom, 'prometheus connector must be listed').toBeTruthy()
    expect(prom!.enabled).toBe(true)
  })

  test('D.3 bootstrap completes and writes bootstrapped_at', async ({ request }) => {
    const trigger = await request.post(`${GATEWAY}/api/connectors/prometheus/bootstrap`, { headers })
    expect(trigger.status(), 'bootstrap trigger must succeed').toBe(200)

    // Bootstrap is async (Redis → GraphBuilderSubscriber). Poll until done.
    const status = await pollUntil(
      async () => {
        const s = await request.get(`${GATEWAY}/api/connectors/prometheus/bootstrap-status`, { headers })
        return await s.json() as { bootstrapped?: boolean; bootstrappedAt?: string }
      },
      (s) => s.bootstrapped === true,
      { intervalMs: 1000, timeoutMs: 30000 },
    ).catch(() => null)

    expect(
      status?.bootstrapped,
      'CERT FAIL: bootstrap did not complete within 30s. ' +
      'GraphBuilderSubscriber not running, no LLM provider, or connector unreachable.'
    ).toBe(true)
    expect(status!.bootstrappedAt, 'bootstrapped_at must be written back').toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT E: Graph indexing', () => {
  test('E.1 services indexed in knowledge graph after bootstrap', async ({ request }) => {
    const services = await pollUntil(
      async () => {
        const r = await request.get(`${GATEWAY}/api/services`, { headers })
        if (r.status() !== 200) return []
        return await r.json() as Array<{ name: string }>
      },
      (list) => list.length > 0,
      { intervalMs: 2000, timeoutMs: 30000 },
    ).catch(() => [] as Array<{ name: string }>)

    expect(
      services.length,
      'CERT FAIL: no services indexed. Demo stack services (payments-api, ' +
      'auth-service, checkout-api) must appear after connector bootstrap. ' +
      'The "No services indexed" empty state in production is a broken pipeline.'
    ).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT F: Alert flow — webhook → incident → signals', () => {
  const alertName = uniqueId('CERT-Alert')
  const WEBHOOK_TOKEN = process.env['ANVAY_WEBHOOK_TOKEN'] ?? 'anvay-demo-webhook-token'

  test('F.1 Alertmanager webhook accepted with static webhook token (real sender path)', async ({ request }) => {
    // This is exactly how Alertmanager calls the gateway: a static bearer
    // token from alertmanager.yml http_config — NOT a tenant JWT. If this
    // fails, every real demo alert is being dropped with a 401.
    const r = await request.post(`${GATEWAY}/api/events/alert`, {
      headers: { 'Authorization': `Bearer ${WEBHOOK_TOKEN}`, 'Content-Type': 'application/json' },
      data: {
        version: '4',
        alerts: [{
          status: 'firing',
          labels: { alertname: alertName, severity: 'high', service: 'payments-api' },
          annotations: { summary: 'Certification suite test alert' },
        }],
      },
    })
    expect(r.status(), 'webhook with ANVAY_WEBHOOK_TOKEN must be accepted — Alertmanager cannot sign JWTs').toBe(200)
  })

  test('F.1b webhook with no/invalid token rejected', async ({ request }) => {
    const r = await request.post(`${GATEWAY}/api/events/alert`, {
      headers: { 'Content-Type': 'application/json' },
      data: { version: '4', alerts: [] },
    })
    expect(r.status()).toBe(401)
  })

  test('F.2 incident created in DB from webhook', async ({ request }) => {
    const incident = await pollUntil(
      async () => {
        const r = await request.get(`${GATEWAY}/api/incidents`, { headers })
        if (r.status() !== 200) return undefined
        const list = await r.json() as Array<{ title: string; severity: string }>
        return list.find(i => i.title === alertName)
      },
      (i) => i !== undefined,
      { intervalMs: 1000, timeoutMs: 15000 },
    ).catch(() => undefined)

    expect(incident, 'CERT FAIL: webhook did not produce an incident in DB').toBeTruthy()
    expect(incident!.severity).toBe('high')
  })

  test('F.3 incident surfaces in /api/alerts (Signals feed)', async ({ request }) => {
    const alert = await pollUntil(
      async () => {
        const r = await request.get(`${GATEWAY}/api/alerts`, { headers })
        if (r.status() !== 200) return undefined
        const list = await r.json() as Array<{ title: string }>
        return list.find(a => a.title === alertName)
      },
      (a) => a !== undefined,
      { intervalMs: 1000, timeoutMs: 10000 },
    ).catch(() => undefined)

    expect(alert, 'CERT FAIL: incident not visible in Signals feed').toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT G: Automations', () => {
  let triggerId: string

  test('G.1 create trigger', async ({ request }) => {
    const r = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        eventType: 'alert_fired',
        condition: { severity: 'critical' },
        actions: [{ type: 'create_incident', params: {} }],
      },
    })
    expect(r.status(), 'trigger creation must succeed').toBeLessThan(300)
    const body = await r.json() as { id?: string } | Array<{ id: string }>
    triggerId = Array.isArray(body) ? body[0]!.id : body.id!
    expect(triggerId, 'created trigger must have id').toBeTruthy()
  })

  test('G.2 trigger listed', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
    expect(r.status()).toBe(200)
    const list = await r.json() as Array<{ id: string }>
    expect(list.some(t => t.id === triggerId), 'created trigger must be listed').toBe(true)
  })

  test('G.3 disable + delete trigger', async ({ request }) => {
    const patch = await request.patch(`${GATEWAY}/api/automations/triggers/${triggerId}`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { enabled: false },
    })
    expect(patch.status()).toBeLessThan(300)

    const del = await request.delete(`${GATEWAY}/api/automations/triggers/${triggerId}`, { headers })
    expect(del.status()).toBeLessThan(300)
  })

  test('G.4 create + list cron monitor', async ({ request }) => {
    const monitorName = uniqueId('cert-monitor')
    const create = await request.post(`${GATEWAY}/api/automations/monitors`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { name: monitorName, schedule: '* * * * *', jobType: 'service_health_sweep' },
    })
    expect(create.status(), 'monitor creation must succeed').toBeLessThan(300)
    const created = await create.json() as { id?: string }
    expect(created.id, 'created monitor must have id').toBeTruthy()

    const list = await request.get(`${GATEWAY}/api/automations/monitors`, { headers })
    expect(list.status()).toBe(200)
    const body = await list.json() as Array<{ name?: string }> | { monitors?: Array<{ name?: string }> }
    const monitors = Array.isArray(body) ? body : (body.monitors ?? [])
    expect(monitors.some(m => m.name === monitorName), 'created monitor must be listed').toBe(true)
  })

  test('G.5 user-created monitor actually runs (lastRunAt written by scheduler)', async ({ request }) => {
    // G.4 created a monitor on an every-minute schedule. The BullMQ scheduler
    // must execute it and write last_run_at — proving user monitors are
    // scheduled for real, not just stored as rows.
    const ran = await pollUntil(
      async () => {
        const r = await request.get(`${GATEWAY}/api/automations/monitors`, { headers })
        if (r.status() !== 200) return false
        const body = await r.json() as Array<{ name?: string; lastRunAt?: string | null }>
        const list = Array.isArray(body) ? body : []
        return list.some(m => m.name?.startsWith('cert-monitor') && m.lastRunAt)
      },
      (done) => done === true,
      { intervalMs: 5000, timeoutMs: 90000 },
    ).catch(() => false)

    expect(
      ran,
      'CERT FAIL: user-created monitor never ran within 90s. ' +
      'Cron rows are stored but not scheduled — proactive intelligence is dead.'
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT H: Audit', () => {
  test('H.1 audit log queryable and contains entries', async ({ request }) => {
    const r = await request.get(`${GATEWAY}/api/audit`, { headers })
    expect(r.status()).toBe(200)
    const body = await r.json() as Array<unknown> | { events?: Array<unknown> }
    const events = Array.isArray(body) ? body : (body.events ?? [])
    // Actions above (connector register, triggers, webhook) must have produced audit entries
    expect(events.length, 'audit log must contain entries after certified actions').toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT I: UI — real data, no mock fallbacks', () => {
  test('I.0 web app cannot self-authenticate — dev-token route removed', async ({ request }) => {
    // The web UI must never mint its own token; only the login flow sets the
    // session cookie. A working /api/auth/dev-token on the web app means
    // login is bypassable.
    const r = await request.get(`${WEB}/api/auth/dev-token`)
    expect(r.status(), 'web /api/auth/dev-token must not exist').toBe(404)
  })

  test('I.1 unauthenticated visit redirects to /login', async ({ page }) => {
    await page.goto(WEB)
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 })
  })

  test('I.2 login flow issues cookie and loads app', async ({ page }) => {
    await page.goto(`${WEB}/login`)
    await page.locator('input[type="email"]').fill(DEMO_EMAIL)
    await page.locator('input[type="text"]').fill(DEMO_TENANT)
    await page.locator('button[type="submit"]').click()
    // 30s: first navigation after submit compiles the app shell in dev mode
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 })
  })

  test('I.3 Signals view shows the certification incident (real data)', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto(WEB)
    await page.locator('text=Signals').first().click()
    // The CERT F incident must be visible — proves feed is DB-backed, not mock
    await expect(
      page.locator('text=CERT-Alert').first(),
      'Signals must render the incident created via webhook — if missing, feed is mock or broken'
    ).toBeVisible({ timeout: 10000 })
  })

  test('I.4 Signals view does NOT show known mock-data markers', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto(WEB)
    await page.locator('text=Signals').first().click()
    await page.waitForLoadState('networkidle')
    // These strings existed only in the removed DEMO_SIGNALS mock constants
    await expect(page.locator('text=Checkout conversion dropped 18%')).toHaveCount(0)
    await expect(page.locator('text=payments-api p99 latency breaching SLO')).toHaveCount(0)
  })

  test('I.5 Services view shows indexed services (real graph data)', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto(WEB)
    await page.locator('text=Services').first().click()
    await expect(
      page.locator('text=No services indexed'),
      'Services view must NOT show empty state — graph must be populated'
    ).toHaveCount(0, { timeout: 10000 })
  })

  test('I.6 no JS errors across certified views', async ({ page, context }) => {
    await setAuthCookie(context)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(WEB)
    for (const view of ['Signals', 'Services', 'Knowledge', 'Automations', 'Audit']) {
      await page.locator(`text=${view}`).first().click()
      await page.waitForLoadState('networkidle')
    }
    expect(errors, `JS errors found: ${errors.join('; ')}`).toHaveLength(0)
  })
})

test.describe('CERT J: secrets at rest', () => {
  test('J.1 no plaintext credential columns remain', async ({ request }) => {
    // Dev-token user is admin; route is admin-only + dev-only. Success path required.
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/debug/at-rest-check`, { headers: h })
    expect(resp.status(), 'admin at-rest-check must return 200').toBe(200)
    const body = await resp.json() as { plaintextColumns: string[]; sampleEncPrefix: boolean }
    expect(
      body.plaintextColumns,
      `CERT FAIL: plaintext credential columns still present: ${body.plaintextColumns.join(', ')}`,
    ).toHaveLength(0)
    expect(body.sampleEncPrefix, 'credentials_enc must be encrypted (v1: prefix)').toBe(true)
  })
})

test.describe('CERT K: per-user perimeter enforcement', () => {
  test('K.1 PUT user perimeter restricts write scope', async ({ request }) => {
    const h = await authHeaders(request)
    const DEMO_USER = '00000000-0000-0000-0000-000000000002'
    // Restrict prometheus write to empty
    const putResp = await request.put(`${GATEWAY}/api/access/users/${DEMO_USER}/perimeter`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { perimeter: [{ connectorName: 'prometheus', readScopes: ['*'], writeScopes: [] }] },
    })
    expect(putResp.status()).toBe(200)

    // Verify GET reflects the change
    const getResp = await request.get(`${GATEWAY}/api/access/users/${DEMO_USER}/perimeter`, { headers: h })
    expect(getResp.status()).toBe(200)
    const perims = await getResp.json() as Array<{ connectorName: string; readScopes: string[]; writeScopes: string[] }>
    const prom = perims.find(p => p.connectorName === 'prometheus')
    expect(prom).toBeTruthy()
    expect(prom!.writeScopes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT M: preview banners', () => {
  test('M.1 mock view (Cloud) shows DESIGN PREVIEW banner', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto(WEB)
    await page.locator('text=Cloud').first().click()
    await expect(
      page.locator('text=DESIGN PREVIEW').first(),
      'Cloud is a design-only mock view and must carry the preview banner'
    ).toBeVisible({ timeout: 10000 })
  })

  test('M.2 real view (Services) shows NO DESIGN PREVIEW banner', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto(WEB)
    await page.locator('text=Services').first().click()
    await page.waitForLoadState('networkidle')
    await expect(
      page.locator('text=DESIGN PREVIEW'),
      'Services is backed by real data and must NOT carry the preview banner'
    ).toHaveCount(0)
  })
})

test.describe('CERT L: graph triage', () => {
  test('L.1 GET /api/graph/triage resolves a real indexed service', async ({ request }) => {
    // CERT D/E already bootstrapped prometheus and indexed services into the
    // graph. Pick a real indexed service name and triage it — proves the graph
    // triage endpoint resolves a primary entity + its one-hop neighbourhood.
    const svcResp = await request.get(`${GATEWAY}/api/services`, { headers })
    expect(svcResp.status(), 'services must be queryable for triage precondition').toBe(200)
    const services = await svcResp.json() as Array<{ name: string }>
    expect(
      services.length,
      'CERT FAIL: no services indexed — triage has no entity to resolve'
    ).toBeGreaterThan(0)

    const target = services.find(s => s.name === 'payments-api')?.name ?? services[0]!.name

    const r = await request.get(`${GATEWAY}/api/graph/triage/${encodeURIComponent(target)}`, { headers })
    expect(r.status(), 'graph triage must resolve an indexed entity').toBe(200)
    const body = await r.json() as { entity: { name: string }; related: Record<string, unknown[]>; recentDeploys: unknown[] }
    expect(body.entity.name, 'triage must return the requested entity').toBe(target)
    expect(body.related, 'triage must return a related map').toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT N: automation run history (P1)', () => {
  test('N.1 a cron monitor that has run persists run rows via /api/cron/:id/runs', async ({ request }) => {
    // CERT G.4/G.5 already created an every-minute monitor and proved it ran
    // (lastRunAt written). By the time CERT N executes, that monitor has
    // completed runs — so automation_runs rows must exist for it.
    const monitorId = await pollUntil(
      async () => {
        const r = await request.get(`${GATEWAY}/api/automations/monitors`, { headers })
        if (r.status() !== 200) return undefined
        const list = await r.json() as Array<{ id: string; lastRunAt: string | null }>
        return (Array.isArray(list) ? list : []).find(m => m.lastRunAt)?.id
      },
      (id) => id !== undefined,
      { intervalMs: 3000, timeoutMs: 25000 },
    ).catch(() => undefined)

    expect(monitorId, 'a monitor with a completed run must exist (see CERT G.5)').toBeTruthy()

    const r = await request.get(`${GATEWAY}/api/cron/${monitorId}/runs`, { headers })
    expect(r.status()).toBe(200)
    const body = await r.json() as { runs: Array<{ status: string; startedAt: string }> }
    expect(
      body.runs.length,
      'CERT FAIL: monitor ran (lastRunAt set) but no automation_runs persisted — run history pipeline broken',
    ).toBeGreaterThan(0)
    expect(body.runs[0]!.status, 'run row must carry a status').toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT O: gate policy + auto-approve enforcement (P3)', () => {
  test('O.1 PUT then GET round-trips a gate policy', async ({ request }) => {
    const put = await request.put(`${GATEWAY}/api/gate/policies`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { scope: '*', approversRequired: 1, autoApproveThreshold: 0.95 },
    })
    expect(put.status(), 'admin PUT gate policy must succeed').toBeLessThan(300)

    const get = await request.get(`${GATEWAY}/api/gate/policies`, { headers })
    expect(get.status()).toBe(200)
    const policies = await get.json() as Array<{ scope: string; autoApproveThreshold: number }>
    const wildcard = policies.find(p => p.scope === '*')
    expect(wildcard, 'wildcard policy must be listed').toBeTruthy()
    expect(wildcard!.autoApproveThreshold).toBeCloseTo(0.95)
  })

  test('O.2 confidence below threshold still gates (pending); above auto-approves', async ({ request }) => {
    // policy threshold = 0.95 from O.1
    const low = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: 'payments-api', confidence: 0.5 },
    })
    expect(low.status()).toBe(201)
    expect((await low.json() as { autoApproved: boolean }).autoApproved, 'low confidence must NOT auto-approve').toBe(false)

    const high = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: 'payments-api', confidence: 0.99 },
    })
    expect(high.status()).toBe(201)
    expect((await high.json() as { autoApproved: boolean }).autoApproved, 'high confidence must auto-approve under policy').toBe(true)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT P: additional monitor types (P2)', () => {
  test('P.1 incident_retrospective monitor is creatable + listed', async ({ request }) => {
    const name = uniqueId('cert-retro')
    const create = await request.post(`${GATEWAY}/api/automations/monitors`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { name, schedule: '0 0 * * 0', jobType: 'incident_retrospective' },
    })
    expect(create.status(), 'incident_retrospective monitor must be creatable').toBeLessThan(300)

    const list = await request.get(`${GATEWAY}/api/automations/monitors`, { headers })
    expect(list.status()).toBe(200)
    const monitors = await list.json() as Array<{ name?: string; jobType?: string }>
    expect(monitors.some(m => m.name === name && m.jobType === 'incident_retrospective'),
      'created monitor must be listed with its jobType').toBe(true)
  })

  test('P.2 cloud_security_scan creatable (returns unconfigured without cloud connector)', async ({ request }) => {
    const create = await request.post(`${GATEWAY}/api/automations/monitors`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { name: uniqueId('cert-cloudsec'), schedule: '0 * * * *', jobType: 'cloud_security_scan' },
    })
    expect(create.status(), 'cloud_security_scan monitor must be creatable').toBeLessThan(300)
  })
})

// ---------------------------------------------------------------------------
test.describe('CERT Q: audit export', () => {
  test('Q.1 admin can export audit log as NDJSON', async ({ request }) => {
    // Dev-token user is admin. Prior cert actions (connector register, triggers,
    // webhook → incident) have written audit_events rows.
    const r = await request.get(`${GATEWAY}/api/audit/export`, { headers })
    expect(r.status(), 'admin audit export must return 200').toBe(200)
    expect(
      r.headers()['content-type'],
      'export must be served as NDJSON',
    ).toContain('ndjson')

    const text = await r.text()
    const lines = text.split('\n').filter(l => l.trim().length > 0)
    expect(lines.length, 'export must contain at least one audit row').toBeGreaterThan(0)

    const parsed = lines.map(l => JSON.parse(l) as Record<string, unknown>)
    expect(
      parsed.some(row => row['event_type'] !== undefined || row['eventType'] !== undefined),
      'each exported row must be a JSON audit event with an event_type field',
    ).toBe(true)
  })
})
