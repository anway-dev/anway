import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, uniqueId } from './fixtures'

test.describe('Alerts — no mock fallback', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test('P0: GET /api/alerts returns real data or empty array — never demo seed', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/alerts`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { data?: Array<{ id: string }> } | Array<{ id: string }>
    const items = Array.isArray(body) ? body : ((body as { data?: Array<{ id: string }> }).data ?? [])

    // Demo seed IDs like "alrt-001", "err-001", "met-001" must never appear
    const demoIds = items.filter(a => a.id.startsWith('alrt-') || a.id.startsWith('err-') || a.id.startsWith('met-'))
    expect(demoIds.length, 'demo seed signals must never be returned').toBe(0)
  })

  test('P0: GET /api/audit returns real data or empty array — never demo seed', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/audit`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { data?: Array<{ id: string }> } | Array<{ id: string }>
    const items = Array.isArray(body) ? body : ((body as { data?: Array<{ id: string }> }).data ?? [])

    // Demo audit IDs like "evt-001" etc must never appear
    const demoIds = items.filter(a => a.id.startsWith('evt-'))
    expect(demoIds.length, 'demo seed audit events must never be returned').toBe(0)
  })

  test('P1: creating an incident makes it appear in GET /api/alerts', async ({ request }) => {
    const title = uniqueId('E2E-alert-real')
    const createResp = await request.post(`${GATEWAY}/api/incidents`, {
      headers,
      data: { title, severity: 'medium' },
    })
    expect([200, 201]).toContain(createResp.status())
    const { id } = await createResp.json() as { id: string }

    // Verify incident appears in alerts (alerts reads from incidents table)
    const alertsResp = await request.get(`${GATEWAY}/api/alerts`, { headers })
    const alertsBody = await alertsResp.json() as { data?: Array<{ id: string; title: string }> } | Array<{ id: string; title: string }>
    const alerts = Array.isArray(alertsBody) ? alertsBody : (alertsBody.data ?? [])
    expect(alerts.some(a => a.title === title || a.id === id),
      'created incident must appear in GET /api/alerts').toBe(true)

    // Cleanup
    await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers }).catch(() => {})
  })
})
