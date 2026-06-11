import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, DEMO_TENANT, uniqueId, pollUntil } from './fixtures'

test.describe('Data Integrity — cross-entity chains', () => {
  let headers: Record<string, string>
  const createdIncidentIds: string[] = []

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test.afterEach(async ({ request }) => {
    for (const id of createdIncidentIds) {
      await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers }).catch(() => {})
    }
    createdIncidentIds.length = 0
  })

  test('P0: incident create -> audit chain', async ({ request }) => {
    const title = uniqueId('E2E-dint')
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { title, severity: 'high' },
    })
    expect([200, 201]).toContain(resp.status())
    const { id } = await resp.json() as { id: string }
    createdIncidentIds.push(id)

    const audit = await pollUntil(
      () => request.get(`${GATEWAY}/api/audit?search=${encodeURIComponent(title)}`, { headers }).then(r => r.json() as Promise<unknown[]>),
      (events) => events.length > 0,
      { intervalMs: 400, timeoutMs: 6000 },
    )
    expect(audit.length).toBeGreaterThan(0)
  })

  test('P0: alert POST -> signal visible', async ({ request }) => {
    const alertName = uniqueId('E2E-alrt')
    const postResp = await request.post(`${GATEWAY}/api/events/alert`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { alerts: [{ status: 'firing', labels: { alertname: alertName, severity: 'high' } }] },
    })
    expect([200, 201, 202, 204]).toContain(postResp.status())

    const alerts = await pollUntil(
      () => request.get(`${GATEWAY}/api/alerts`, { headers }).then(r => r.json() as Promise<Array<{ title: string; severity?: string }>>),
      (list) => list.some(a => a.title === alertName),
      { intervalMs: 400, timeoutMs: 8000 },
    )
    const found = alerts.find(a => a.title === alertName)
    expect(found, 'alert must appear in alerts list after POST').toBeTruthy()
    expect(found!.severity, 'alert must have severity').toBeTruthy()
  })
})
