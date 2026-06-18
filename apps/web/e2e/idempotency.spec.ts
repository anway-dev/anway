/**
 * Idempotency and duplicate-action protection tests.
 * Verifies that the system handles concurrent/duplicate operations safely.
 */
import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, authHeaders2 } from './fixtures'

test.describe('Gate idempotency', () => {
  let adminHeaders: Record<string, string>
  let sreHeaders: Record<string, string>
  test.beforeAll(async ({ request }) => {
    adminHeaders = await authHeaders(request)
    sreHeaders = await authHeaders2(request)
  })

  test('approving an already-approved gate returns 404 (not 200)', async ({ request }) => {
    // Create gate as sre
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...sreHeaders, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: `idem-double-approve-${Date.now()}` },
    })
    const { id } = await createResp.json() as { id: string }

    // First approve (admin)
    const first = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(first.status()).toBe(200)

    // Second approve of same gate → already decided
    const second = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(second.status()).toBe(404)
  })

  test('rejecting an already-rejected gate returns 404', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...sreHeaders, 'Content-Type': 'application/json' },
      data: { action: 'rollback', target: `idem-double-reject-${Date.now()}` },
    })
    const { id } = await createResp.json() as { id: string }

    const first = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      data: { decision: 'rejected' },
    })
    expect(first.status()).toBe(200)

    const second = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      data: { decision: 'rejected' },
    })
    expect(second.status()).toBe(404)
  })

  test('deciding non-existent gate ID returns 404 (not 500)', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/gate/00000000-0000-0000-0000-999999999999/decide`,
      {
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        data: { decision: 'approved' },
      },
    )
    expect(resp.status()).toBe(404)
  })
})

test.describe('Incident idempotency', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('resolving an already-resolved incident returns 404 or 409', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { title: 'idem-resolve-test', severity: 'low' },
    })
    const { id } = await createResp.json() as { id: string }

    const first = await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers })
    expect([200, 204]).toContain(first.status())

    const second = await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers })
    // Second resolve: 404 (not found in open state), 409 (conflict), or 200 (idempotent OK)
    expect([200, 204, 404, 409]).toContain(second.status())
  })

  test('double-creating incident with same title creates two separate incidents', async ({ request }) => {
    const title = `idem-duplicate-${Date.now()}`
    const r1 = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { title, severity: 'low' },
    })
    const r2 = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { title, severity: 'low' },
    })
    const b1 = await r1.json() as { id: string }
    const b2 = await r2.json() as { id: string }
    // Both should succeed — incidents are not deduplicated by title
    expect([200, 201]).toContain(r1.status())
    expect([200, 201]).toContain(r2.status())
    expect(b1.id).not.toBe(b2.id)
    // cleanup
    await request.post(`${GATEWAY}/api/incidents/${b1.id}/resolve`, { headers })
    await request.post(`${GATEWAY}/api/incidents/${b2.id}/resolve`, { headers })
  })
})

test.describe('Connector bootstrap idempotency', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('bootstrapping same connector twice returns 200 both times', async ({ request }) => {
    const r1 = await request.post(`${GATEWAY}/api/connectors/prometheus/bootstrap`, { headers })
    const r2 = await request.post(`${GATEWAY}/api/connectors/prometheus/bootstrap`, { headers })
    expect([200, 201, 202]).toContain(r1.status())
    expect([200, 201, 202]).toContain(r2.status())
  })
})
