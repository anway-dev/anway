import { test, expect } from '@playwright/test'
import { GATEWAY, DEMO_TENANT, authHeaders } from './fixtures'

test.describe('Cert check 3 — Alert flow: webhook → Redis → incident', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test('POST /api/events/alert (Alertmanager format) creates incident', async ({ request }) => {
    const alertName = `E2E-Cert3-${Date.now()}`

    // events/alert requires auth (JWT or webhook token); use JWT in e2e
    const alertResp = await request.post(`${GATEWAY}/api/events/alert`, {
      headers,
      data: {
        version: '4',
        alerts: [{
          status: 'firing',
          labels: { alertname: alertName, severity: 'high', service: 'checkout-api' },
          annotations: { summary: 'E2E cert-3 test alert' },
        }],
      },
    })
    expect(alertResp.status()).toBe(200)

    // Wait for Redis → alert-subscriber → DB write
    await new Promise(r => setTimeout(r, 800))

    // Verify incident created
    const incResp = await request.get(`${GATEWAY}/api/incidents`, { headers })
    expect(incResp.status()).toBe(200)
    const incBody = await incResp.json() as { data?: Array<{ title: string }> } | Array<{ title: string }>
    const incidents = Array.isArray(incBody) ? incBody : (incBody.data ?? [])
    const found = incidents.some(i => i.title === alertName)
    expect(found).toBe(true)
  })
})

test.describe('Cert check extended — event receivers', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test('POST /api/events/deploy without required fields returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/events/deploy`, {
      headers,
      data: {},
    })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/events/deploy with valid fields returns 200', async ({ request }) => {
    // Schema requires 'service' and 'sha' (not 'app')
    const resp = await request.post(`${GATEWAY}/api/events/deploy`, {
      headers,
      data: { service: 'payments-api', sha: 'abc123' },
    })
    expect(resp.status()).toBe(200)
  })

  test('POST /api/events/pr-merged without required fields returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/events/pr-merged`, {
      headers,
      data: {},
    })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/events/pr-merged with valid fields returns 200', async ({ request }) => {
    // Schema requires 'repo'; prNumber (not pr) is optional
    const resp = await request.post(`${GATEWAY}/api/events/pr-merged`, {
      headers,
      data: { repo: 'test', prNumber: 1 },
    })
    expect(resp.status()).toBe(200)
  })
})
