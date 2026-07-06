import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, authHeaders2, uniqueId } from './fixtures'

// User ...0002 is now dedicated to e2e/99-certification.spec.ts's CERT K/U/AQ/AS
// perimeter checks (see prisma/seed.ts) — role 'dev', email cert-user2@demo.anway.dev.
// This test used to assume an older admin/dev@anway.local identity for that same
// id; updated to match what's actually seeded now rather than resurrecting the
// old identity and risking the certification suite's own hardcoded expectations.
// Only admin can manage users + perimeters.

const DEV_USER_ID = '00000000-0000-0000-0000-000000000002'
const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'

test.describe('Access API — GET /api/access/users', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/access/users`)
    expect(resp.status()).toBe(401)
  })

  test('returns 403 for non-admin (dev2/sre)', async ({ request }) => {
    const h = await authHeaders2(request)
    const resp = await request.get(`${GATEWAY}/api/access/users`, { headers: h })
    expect(resp.status()).toBe(403)
  })

  test('returns user list as admin', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/access/users`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as Array<{ id: string; email: string; role: string; createdAt: string }>
    expect(Array.isArray(body)).toBe(true)
    const devUser = body.find(u => u.id === DEV_USER_ID)
    expect(devUser, 'dev user must appear in list').toBeDefined()
    expect(devUser?.role).toBe('dev')
    expect(devUser?.email).toBe('cert-user2@demo.anway.dev')
  })
})

test.describe('Access API — GET /api/access/users/:id/perimeter', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`)
    expect(resp.status()).toBe(401)
  })

  test('returns 403 for non-admin', async ({ request }) => {
    const h = await authHeaders2(request)
    const resp = await request.get(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`, { headers: h })
    expect(resp.status()).toBe(403)
  })

  test('returns 400 for malformed userId', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/access/users/not-a-uuid/perimeter`, { headers: h })
    expect(resp.status()).toBe(400)
  })

  test('returns perimeter array as admin', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown
    expect(Array.isArray(body)).toBe(true)
  })
})

test.describe('Access API — PUT /api/access/users/:id/perimeter', () => {
  const perimeter = [
    { connectorName: 'github', readScopes: ['org/*'], writeScopes: [] },
    { connectorName: 'datadog', readScopes: ['*'], writeScopes: [] },
  ]

  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`, {
      data: { perimeter },
    })
    expect(resp.status()).toBe(401)
  })

  test('returns 403 for non-admin', async ({ request }) => {
    const h = await authHeaders2(request)
    const resp = await request.put(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { perimeter },
    })
    expect(resp.status()).toBe(403)
  })

  test('returns 400 for malformed userId', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.put(`${GATEWAY}/api/access/users/bad-id/perimeter`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { perimeter },
    })
    expect(resp.status()).toBe(400)
  })

  test('upserts perimeter and returns ok:true', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.put(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { perimeter },
    })
    expect([200, 201]).toContain(resp.status())
    const body = await resp.json() as { ok: boolean; count: number }
    expect(body.ok).toBe(true)
    expect(body.count).toBeGreaterThan(0)
  })

  test('verify perimeter persisted via GET', async ({ request }) => {
    const h = await authHeaders(request)
    // Set a distinctive perimeter
    const unique = uniqueId('conn')
    await request.put(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { perimeter: [{ connectorName: unique, readScopes: ['test-scope'], writeScopes: [] }] },
    })
    const getResp = await request.get(`${GATEWAY}/api/access/users/${DEV_USER_ID}/perimeter`, { headers: h })
    expect(getResp.status()).toBe(200)
    const rows = await getResp.json() as Array<{ connectorName: string; readScopes: string[] }>
    const found = rows.find(r => r.connectorName === unique)
    expect(found, 'upserted perimeter entry must be readable').toBeDefined()
    expect(found?.readScopes).toContain('test-scope')
  })
})

test.describe('Access API — POST /api/access/users (provision)', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/access/users`, {
      data: { email: 'e2e-test@anway.local', role: 'dev' },
    })
    expect(resp.status()).toBe(401)
  })

  test('returns 403 for non-admin', async ({ request }) => {
    const h = await authHeaders2(request)
    const resp = await request.post(`${GATEWAY}/api/access/users`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { email: 'e2e-test@anway.local', role: 'dev' },
    })
    expect(resp.status()).toBe(403)
  })

  test('returns 400 for missing email', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/access/users`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { role: 'dev' },
    })
    expect(resp.status()).toBe(400)
  })

  test('returns 400 for invalid role', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/access/users`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { email: `e2e-${uniqueId('u')}@anway.local`, role: 'superadmin' },
    })
    expect(resp.status()).toBe(400)
  })

  test('provisions new user and returns id', async ({ request }) => {
    const h = await authHeaders(request)
    const email = `e2e-${uniqueId('prov')}@anway.local`
    const resp = await request.post(`${GATEWAY}/api/access/users`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { email, role: 'dev' },
    })
    expect([200, 201]).toContain(resp.status())
    const body = await resp.json() as { id: string; email: string; role: string }
    expect(body.id, 'provisioned user must have UUID id').toBeTruthy()
    expect(body.email).toBe(email)
    expect(body.role).toBe('dev')
  })

  test('provisioned user appears in user list', async ({ request }) => {
    const h = await authHeaders(request)
    const email = `e2e-${uniqueId('list')}@anway.local`
    const createResp = await request.post(`${GATEWAY}/api/access/users`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { email, role: 'sre' },
    })
    expect([200, 201]).toContain(createResp.status())
    const { id } = await createResp.json() as { id: string }

    const listResp = await request.get(`${GATEWAY}/api/access/users`, { headers: h })
    expect(listResp.status()).toBe(200)
    const users = await listResp.json() as Array<{ id: string; email: string; role: string }>
    const found = users.find(u => u.id === id)
    expect(found, 'provisioned user must appear in user list').toBeDefined()
    expect(found?.role).toBe('sre')
  })
})

test.describe('Access API — PATCH /api/access/users/:id/role', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.patch(`${GATEWAY}/api/access/users/${DEV_USER_ID}/role`, {
      data: { role: 'sre' },
    })
    expect(resp.status()).toBe(401)
  })

  test('returns 403 for non-admin', async ({ request }) => {
    const h = await authHeaders2(request)
    const resp = await request.patch(`${GATEWAY}/api/access/users/${DEV_USER_ID}/role`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { role: 'sre' },
    })
    expect(resp.status()).toBe(403)
  })

  test('returns 400 for invalid role', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.patch(`${GATEWAY}/api/access/users/${DEV_USER_ID}/role`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { role: 'overlord' },
    })
    expect(resp.status()).toBe(400)
  })

  test('updates role for provisioned user', async ({ request }) => {
    const h = await authHeaders(request)
    // Provision a user first
    const email = `e2e-${uniqueId('role')}@anway.local`
    const createResp = await request.post(`${GATEWAY}/api/access/users`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { email, role: 'dev' },
    })
    expect([200, 201]).toContain(createResp.status())
    const { id } = await createResp.json() as { id: string }

    // Update role
    const patchResp = await request.patch(`${GATEWAY}/api/access/users/${id}/role`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { role: 'sre' },
    })
    expect(patchResp.status()).toBe(200)
    const body = await patchResp.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify via user list
    const listResp = await request.get(`${GATEWAY}/api/access/users`, { headers: h })
    const users = await listResp.json() as Array<{ id: string; role: string }>
    const found = users.find(u => u.id === id)
    expect(found?.role, 'role must be updated to sre').toBe('sre')
  })
})
