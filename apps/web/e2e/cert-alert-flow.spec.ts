import { test, expect } from '@playwright/test'

const GATEWAY = 'http://127.0.0.1:4000'
const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'

test.describe('Cert check 3 — Alert flow: webhook → Redis → incident', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    const r = await request.get(`${GATEWAY}/api/auth/dev-token`)
    const body = await r.json() as { token?: string }
    token = body.token ?? ''
  })

  test('POST /api/events/alert (Alertmanager format) creates incident', async ({ request }) => {
    const alertName = `E2E-Cert3-${Date.now()}`

    // Send Alertmanager-format webhook (no auth — public endpoint)
    const alertResp = await request.post(`${GATEWAY}/api/events/alert`, {
      data: {
        tenantId: DEMO_TENANT,
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
    const incResp = await request.get(`${GATEWAY}/api/incidents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(incResp.status()).toBe(200)
    const incidents = await incResp.json() as Array<{ title: string }>
    const found = incidents.some(i => i.title === alertName)
    expect(found).toBe(true)
  })
})
