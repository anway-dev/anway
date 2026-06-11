import { test, expect } from '@playwright/test'
import { GATEWAY, DEMO_TENANT, authHeaders } from './fixtures'

const CONNECTOR_KEY = 'e2e-key'

test.describe('Graph Events — tenant binding', () => {
  test('valid key + matching tenant → 200 or 503', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/graph/events`, {
      headers: { 'x-connector-key': CONNECTOR_KEY, 'Content-Type': 'application/json' },
      data: { type: 'pr_merged', tenantId: DEMO_TENANT, repo: 'test/repo', sha: 'abc123' },
    })
    expect([200, 503]).toContain(resp.status())
  })

  test('valid key + wrong tenant → 403', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/graph/events`, {
      headers: { 'x-connector-key': CONNECTOR_KEY, 'Content-Type': 'application/json' },
      data: { type: 'pr_merged', tenantId: '00000000-0000-0000-0000-000000000099' },
    })
    expect(resp.status()).toBe(403)
  })

  test('no key → 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/graph/events`, {
      data: { type: 'pr_merged', tenantId: DEMO_TENANT },
    })
    expect(resp.status()).toBe(401)
  })

  test('invalid key → 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/graph/events`, {
      headers: { 'x-connector-key': 'bad-key', 'Content-Type': 'application/json' },
      data: { type: 'pr_merged', tenantId: DEMO_TENANT },
    })
    expect(resp.status()).toBe(401)
  })
})

test.describe('Gate — full REST roundtrip', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test('create gate then decide via REST → ok: true', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: 'e2e-svc', requestedBy: 'e2e-test' },
    })
    expect(createResp.status()).toBe(201)
    const { id } = await createResp.json() as { id: string }
    expect(id).toBeTruthy()

    const decideResp = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(decideResp.status()).toBe(200)
    const body = await decideResp.json() as { ok: boolean; gateId: string; decision: string }
    expect(body.ok).toBe(true)
    expect(body.gateId).toBe(id)
    expect(body.decision).toBe('approved')
  })

  test('decide already-decided gate → 404', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { action: 'scale', target: 'payments-api' },
    })
    const { id } = await createResp.json() as { id: string }
    await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    const secondResp = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { decision: 'rejected' },
    })
    expect(secondResp.status()).toBe(404)
  })
})
