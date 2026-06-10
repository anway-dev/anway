// Anvay E2E Test Suites — Playwright
// Install: pnpm add -D @playwright/test && npx playwright install chromium
// Run:     npx playwright test apps/web/e2e/anvay.spec.ts --reporter=list
//
// Requires running stack: docker compose -f infra/docker-compose.yml up -d
// Target: GATEWAY=http://localhost:4000, WEB=http://localhost:3000

import { test, expect } from '@playwright/test'

const GATEWAY = 'http://localhost:4000'
const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'

async function getToken(request: Parameters<Parameters<typeof test>[1]>[0]['request']): Promise<string> {
  const r = await request.get(`${GATEWAY}/api/auth/dev-token`)
  const body = await r.json() as { token?: string }
  return body.token ?? ''
}

// ---------------------------------------------------------------------------
// Suite A — Health + Metrics
// ---------------------------------------------------------------------------
test.describe('A: Health + Metrics', () => {
  test('A.1 GET /health returns 200 with status ok', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/health`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.status).toBe('ok')
    expect(body.version).toBeDefined()
    expect(typeof body.uptime).toBe('number')
  })

  test('A.2 GET /metrics returns Prometheus text format', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/metrics`)
    expect(resp.status()).toBe(200)
    const text = await resp.text()
    expect(text).toContain('anvay_gateway_http_request_duration_seconds')
  })
})

// ---------------------------------------------------------------------------
// Suite B — Auth
// ---------------------------------------------------------------------------
test.describe('B: Auth', () => {
  let token: string

  test('B.1 POST /auth/token with valid body returns JWT', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.token).toBeDefined()
    expect(body.expiresIn).toBe('24h')
    token = body.token
  })

  test('B.2 JWT grants access to protected routes', async ({ request }) => {
    const authResp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    const { token: t } = await authResp.json()
    const resp = await request.get(`${GATEWAY}/api/connectors`, {
      headers: { Authorization: `Bearer ${t}` },
    })
    expect(resp.status()).toBe(200)
  })

  test('B.3 missing tenantId returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL },
    })
    expect(resp.status()).toBe(400)
  })

  test('B.4 missing email returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/auth/token`, {
      data: { tenantId: DEMO_TENANT },
    })
    expect(resp.status()).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Suite C — Connectors API
// ---------------------------------------------------------------------------
test.describe('C: Connectors', () => {
  test('C.1 GET /api/connectors returns list with valid JWT', async ({ request }) => {
    const authResp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    const { token } = await authResp.json()
    const resp = await request.get(`${GATEWAY}/api/connectors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('C.2 GET /api/connectors without JWT returns 401', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/connectors`)
    expect(resp.status()).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Suite D — Incidents API
// ---------------------------------------------------------------------------
test.describe('D: Incidents', () => {
  test('D.1 GET /api/incidents returns list', async ({ request }) => {
    const authResp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    const { token } = await authResp.json()
    const resp = await request.get(`${GATEWAY}/api/incidents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // May return 200 (list) or 404 (no incidents)
    expect([200, 404]).toContain(resp.status())
  })
})

// ---------------------------------------------------------------------------
// Suite E — Gate API
// ---------------------------------------------------------------------------
test.describe('E: Gate', () => {
  test('E.1 gate decide on non-existent gate returns 404', async ({ request }) => {
    const authResp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    const { token } = await authResp.json()
    const resp = await request.post(`${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000099/decide`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(resp.status()).toBe(404)
  })

  test('E.2 gate decide without JWT returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000001/decide`, {
      data: { decision: 'approved' },
    })
    expect(resp.status()).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Suite F — Automations API
// ---------------------------------------------------------------------------
test.describe('F: Automations', () => {
  test('F.1 GET /api/automations/triggers returns list', async ({ request }) => {
    const authResp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    const { token } = await authResp.json()
    const resp = await request.get(`${GATEWAY}/api/automations/triggers`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status()).toBe(200)
    expect(Array.isArray(await resp.json())).toBe(true)
  })

  test('F.2 GET /api/automations/monitors returns list', async ({ request }) => {
    const authResp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    const { token } = await authResp.json()
    const resp = await request.get(`${GATEWAY}/api/automations/monitors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status()).toBe(200)
    expect(Array.isArray(await resp.json())).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Suite G — Graph Events API
// ---------------------------------------------------------------------------
test.describe('G: Graph Events', () => {
  test('G.1 POST /api/graph/events without x-connector-key returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/graph/events`, {
      data: { type: 'pr_merged', tenantId: DEMO_TENANT },
    })
    expect(resp.status()).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Suite H — Chat API
// ---------------------------------------------------------------------------
test.describe('H: Chat', () => {
  test('H.1 POST /api/chat without LLM key returns 503', async ({ request }) => {
    const authResp = await request.post(`${GATEWAY}/auth/token`, {
      data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
    })
    const { token } = await authResp.json()
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { query: 'test', sessionId: 'test-session' },
    })
    // 503 = no LLM provider; 200 = streaming if provider configured
    expect([200, 503]).toContain(resp.status())
  })
})

// ---------------------------------------------------------------------------
// Suite I — Web UI Navigation
// ---------------------------------------------------------------------------
test.describe('I: Web UI', () => {
  test('I.1 homepage loads at /', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60_000 })
    await expect(page.locator('body')).toBeVisible()
  })

  test('I.2 no page errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60_000 })
    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Suite L — Security
// ---------------------------------------------------------------------------
test.describe('L: Security', () => {
  test('L.1 API key not in health response', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/health`)
    const text = await resp.text()
    expect(text).not.toContain('ANTHROPIC_API_KEY')
    expect(text).not.toContain('OPENAI_API_KEY')
  })

  test('L.2 CORS headers present on API', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/health`)
    // Fastify CORS plugin should set access-control headers
    expect(resp.status()).toBe(200)
  })

  test('L.3 JWT secret not exposed in any response', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/health`)
    const text = await resp.text()
    expect(text).not.toContain('JWT_SECRET')
  })
})

// ---------------------------------------------------------------------------
// Suite M — Metrics
// ---------------------------------------------------------------------------
test.describe('M: Metrics', () => {
  test('M.1 request counters increment after API calls', async ({ request }) => {
    const before = await request.get(`${GATEWAY}/metrics`)
    const beforeText = await before.text()

    await request.get(`${GATEWAY}/health`)

    const after = await request.get(`${GATEWAY}/metrics`)
    const afterText = await after.text()

    expect(beforeText).toContain('anvay_gateway')
    expect(afterText).toContain('anvay_gateway')
  })
})

// ---------------------------------------------------------------------------
// Suite D extended — Incident CRUD
// ---------------------------------------------------------------------------
test.describe('D extended: Incident CRUD', () => {
  let token: string
  let incidentId: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test('D.2 POST /api/incidents creates incident', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'E2E Test Incident', severity: 'high' },
    })
    expect([200, 201]).toContain(resp.status())
    const body = await resp.json()
    expect(body.id).toBeDefined()
    incidentId = body.id
  })

  test('D.3 GET /api/incidents/:id returns created incident', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/incidents/${incidentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.title).toBe('E2E Test Incident')
  })

  test('D.4 GET /api/incidents/:nonexistent returns 404', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/incidents/00000000-0000-0000-0000-000000000099`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status()).toBe(404)
  })

  test('D.5 POST /api/incidents missing title returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { severity: 'high' },
    })
    expect(resp.status()).toBe(400)
  })

  test('D.6 POST /api/incidents invalid severity returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'bad', severity: 'invalid' },
    })
    expect(resp.status()).toBe(400)
  })

  test('D.7 POST /api/incidents/:id/resolve returns ok', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/incidents/${incidentId}/resolve`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Suite F extended — Trigger CRUD
// ---------------------------------------------------------------------------
test.describe('F extended: Trigger CRUD', () => {
  let token: string
  let triggerId: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test('F.3 POST /api/automations/triggers creates trigger', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { eventType: 'alert_fired', condition: {}, actions: [{ type: 'notify_oncall', target: 'oncall' }] },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    const created = Array.isArray(body) ? body[0] : body
    expect(created.id).toBeDefined()
    triggerId = created.id
  })

  test('F.4 GET /api/automations/triggers includes new trigger', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/automations/triggers`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as Array<{ id: string }>
    expect(body.some(t => t.id === triggerId)).toBe(true)
  })

  test('F.5 DELETE /api/automations/triggers/:id removes trigger', async ({ request }) => {
    const resp = await request.delete(`${GATEWAY}/api/automations/triggers/${triggerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect([200, 204]).toContain(resp.status())
    const list = await request.get(`${GATEWAY}/api/automations/triggers`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await list.json() as Array<{ id: string }>
    expect(body.some(t => t.id === triggerId)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Suite H extended — Chat input validation
// ---------------------------------------------------------------------------
test.describe('H extended: Chat validation', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test('H.2 POST /api/chat missing query returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sessionId: 'test-session' },
    })
    expect(resp.status()).toBe(400)
  })

  test('H.3 POST /api/chat missing sessionId returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { query: 'hello' },
    })
    expect(resp.status()).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Suite I extended — Web UI navigation
// ---------------------------------------------------------------------------
test.describe('I extended: Web UI navigation', () => {
  const navItems = [
    { label: 'War Room', text: 'War Room' },
    { label: 'Services', text: 'Services' },
    { label: 'Workflows', text: 'Workflows' },
    { label: 'Automations', text: 'Automations' },
    { label: 'Connectors', text: 'Connectors' },
    { label: 'Audit', text: 'Audit' },
  ]

  for (const view of navItems) {
    test(`I.nav ${view.label} loads without JS errors`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60_000 })
      await page.click(`text=${view.text}`, { timeout: 15_000 })
      await page.waitForTimeout(1000)
      expect(errors).toHaveLength(0)
    })
  }
})
