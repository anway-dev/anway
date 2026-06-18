/**
 * RBAC enforcement — every role-restricted route tested with an insufficient role.
 * dev-token  = admin
 * dev-token2 = sre
 * dev-token3 = dev
 *
 * Tests cover sre vs admin-only routes, and dev vs sre/admin-only routes.
 */
import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, authHeaders2, authHeaders3 } from './fixtures'

test.describe('RBAC — admin-only routes reject sre', () => {
  let sreHeaders: Record<string, string>
  test.beforeAll(async ({ request }) => { sreHeaders = await authHeaders2(request) })

  test('GET /api/access/users — sre returns 403', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/access/users`, { headers: sreHeaders })
    expect(resp.status()).toBe(403)
  })

  test('POST /api/access/users — sre returns 403', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/access/users`, {
      headers: { ...sreHeaders, 'Content-Type': 'application/json' },
      data: { email: 'rbac-test@anvay.local', role: 'dev' },
    })
    expect(resp.status()).toBe(403)
  })

  test('PUT /api/access/users/:id/perimeter — sre returns 403', async ({ request }) => {
    const resp = await request.put(
      `${GATEWAY}/api/access/users/00000000-0000-0000-0000-000000000002/perimeter`,
      {
        headers: { ...sreHeaders, 'Content-Type': 'application/json' },
        data: { perimeter: [] },
      },
    )
    expect(resp.status()).toBe(403)
  })

  test('PATCH /api/access/users/:id/role — sre returns 403', async ({ request }) => {
    const resp = await request.patch(
      `${GATEWAY}/api/access/users/00000000-0000-0000-0000-000000000002/role`,
      {
        headers: { ...sreHeaders, 'Content-Type': 'application/json' },
        data: { role: 'pm' },
      },
    )
    expect(resp.status()).toBe(403)
  })

  test('DELETE /api/admin/token-usage/reset — sre returns 403', async ({ request }) => {
    const resp = await request.delete(`${GATEWAY}/api/admin/token-usage/reset`, { headers: sreHeaders })
    expect(resp.status()).toBe(403)
  })

  test('PUT /api/gate/policies — sre returns 403', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/gate/policies`, {
      headers: { ...sreHeaders, 'Content-Type': 'application/json' },
      data: { scope: '*', approversRequired: 1, autoApproveThreshold: 0.95 },
    })
    expect(resp.status()).toBe(403)
  })
})

test.describe('RBAC — pm/admin-only routes reject sre', () => {
  let sreHeaders: Record<string, string>
  test.beforeAll(async ({ request }) => { sreHeaders = await authHeaders2(request) })

  test('POST /api/lifecycle/prd — sre returns 403', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/lifecycle/prd`, {
      headers: { ...sreHeaders, 'Content-Type': 'application/json' },
      data: { title: 'Test PRD', description: 'rbac-test' },
    })
    expect(resp.status()).toBe(403)
  })

  test('POST /api/lifecycle/prd/:id/approve — sre returns 403', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/lifecycle/prd/00000000-0000-0000-0000-000000000099/approve`,
      { headers: { ...sreHeaders, 'Content-Type': 'application/json' }, data: {} },
    )
    expect(resp.status()).toBe(403)
  })

  test('POST /api/lifecycle/techspec/:id/approve — sre returns 403', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/lifecycle/techspec/00000000-0000-0000-0000-000000000099/approve`,
      { headers: { ...sreHeaders, 'Content-Type': 'application/json' }, data: {} },
    )
    expect(resp.status()).toBe(403)
  })
})

test.describe('RBAC — admin routes accept admin token', () => {
  let adminHeaders: Record<string, string>
  test.beforeAll(async ({ request }) => { adminHeaders = await authHeaders(request) })

  test('GET /api/access/users — admin returns 200', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/access/users`, { headers: adminHeaders })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  test('DELETE /api/admin/token-usage/reset — admin returns 200', async ({ request }) => {
    const resp = await request.delete(`${GATEWAY}/api/admin/token-usage/reset`, { headers: adminHeaders })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { deleted: number; date: string }
    expect(typeof body.deleted).toBe('number')
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('GET /api/access/users/:userId/perimeter — admin can read perimeter', async ({ request }) => {
    const resp = await request.get(
      `${GATEWAY}/api/access/users/00000000-0000-0000-0000-000000000002/perimeter`,
      { headers: adminHeaders },
    )
    expect(resp.status()).toBe(200)
    expect(Array.isArray(await resp.json())).toBe(true)
  })
})

test.describe('RBAC — gate SoD (creator cannot approve own gate)', () => {
  let adminHeaders: Record<string, string>
  let sreHeaders: Record<string, string>
  test.beforeAll(async ({ request }) => {
    adminHeaders = await authHeaders(request)
    sreHeaders = await authHeaders2(request)
  })

  test('admin-created gate cannot be approved by admin (SoD violation → 403)', async ({ request }) => {
    // Create gate as admin
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: `rbac-sod-test-${Date.now()}` },
    })
    expect([200, 201]).toContain(createResp.status())
    const { id } = await createResp.json() as { id: string }

    // Try to approve as admin (same user who created it) → SoD violation
    const decideResp = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(decideResp.status()).toBe(403)
  })

  test('sre-created gate approved by admin succeeds (different users → ok)', async ({ request }) => {
    // Create gate as sre
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...sreHeaders, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: `rbac-sod-ok-${Date.now()}` },
    })
    expect([200, 201]).toContain(createResp.status())
    const { id } = await createResp.json() as { id: string }

    // Approve as admin (different user) → should succeed
    const decideResp = await request.post(`${GATEWAY}/api/gate/${id}/decide`, {
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(decideResp.status()).toBe(200)
  })
})

test.describe('RBAC — dev-role routes reject sre/admin-only endpoints', () => {
  let devHeaders: Record<string, string>
  test.beforeAll(async ({ request }) => { devHeaders = await authHeaders3(request) })

  test('POST /api/automations/triggers — dev returns 403', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers: { ...devHeaders, 'Content-Type': 'application/json' },
      data: { name: 'rbac-dev-test', eventType: 'alert_fired', condition: { threshold: 0 }, actions: [] },
    })
    expect(resp.status()).toBe(403)
  })

  test('POST /api/gate/:id/decide — dev returns 403', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000099/decide`,
      {
        headers: { ...devHeaders, 'Content-Type': 'application/json' },
        data: { decision: 'approved' },
      },
    )
    // 403 = dev not allowed; 404 = gate not found (but auth check first for most routes)
    expect([403, 404]).toContain(resp.status())
  })

  test('POST /api/k8s/nodes/:name/cordon — dev returns 403', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/k8s/nodes/worker-1/cordon`, {
      headers: { ...devHeaders, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(resp.status()).toBe(403)
  })

  test('POST /api/oncall/shift-brief — dev returns 403', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/oncall/shift-brief`, {
      headers: { ...devHeaders, 'Content-Type': 'application/json' },
      data: { teamName: 'platform' },
    })
    expect(resp.status()).toBe(403)
  })

  test('POST /api/connectors/prometheus/bootstrap — dev returns 403', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/connectors/prometheus/bootstrap`, {
      headers: devHeaders,
    })
    expect(resp.status()).toBe(403)
  })

  test('PUT /api/gate/policies — dev returns 403', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/gate/policies`, {
      headers: { ...devHeaders, 'Content-Type': 'application/json' },
      data: { scope: '*', approversRequired: 1, autoApproveThreshold: 0.95 },
    })
    expect(resp.status()).toBe(403)
  })
})
