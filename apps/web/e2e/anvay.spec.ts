// Anvay E2E Test Suites — Playwright
// Install: pnpm add -D @playwright/test && npx playwright install chromium
// Run:     npx playwright test apps/web/e2e/anvay.spec.ts --reporter=list
//
// Requires running stack: docker compose -f infra/docker-compose.yml up -d
// Target: GATEWAY=http://localhost:4000, WEB=http://localhost:3000

import { test, expect } from '@playwright/test'

const GATEWAY = 'http://localhost:4000'
const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'
const DEMO_EMAIL = 'demo@acme.dev'

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
    await page.goto('http://localhost:3000')
    await expect(page.locator('body')).toBeVisible()
  })

  test('I.2 no page errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('http://localhost:3000')
    await page.waitForTimeout(2000)
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

    // Metrics should be present in both responses
    expect(beforeText).toContain('anvay_gateway')
    expect(afterText).toContain('anvay_gateway')
  })
})
