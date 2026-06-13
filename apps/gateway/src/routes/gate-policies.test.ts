import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../app.js'
import { initMetrics } from '../metrics.js'

process.env['JWT_SECRET'] = 'test-secret'

let app: Awaited<ReturnType<typeof buildApp>>

function tokenFor(role: string): string {
  return app.jwt.sign({
    sub: '00000000-0000-0000-0000-000000000002',
    email: 'u@example.com',
    tenantId: '00000000-0000-0000-0000-000000000001',
    role,
  })
}

beforeAll(async () => {
  initMetrics()
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

describe('GET /api/gate/policies', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/gate/policies' })
    expect(res.statusCode).toBe(401)
  })

  it('returns an array (or DB error) for an authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gate/policies',
      headers: { authorization: `Bearer ${tokenFor('dev')}` },
    })
    // 200 with array when DB available; on DB failure the handler catches and returns []
    expect([200, 500, 503]).toContain(res.statusCode)
    if (res.statusCode === 200) {
      expect(Array.isArray(JSON.parse(res.body))).toBe(true)
    }
  })
})

describe('PUT /api/gate/policies', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/gate/policies',
      payload: { scope: '*', approversRequired: 1, autoApproveThreshold: 0.9 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for a non-admin user', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/gate/policies',
      headers: { authorization: `Bearer ${tokenFor('dev')}` },
      payload: { scope: '*', approversRequired: 1, autoApproveThreshold: 0.9 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 for an admin with invalid approversRequired', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/gate/policies',
      headers: { authorization: `Bearer ${tokenFor('admin')}` },
      payload: { scope: '*', approversRequired: 0, autoApproveThreshold: 0.9 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for an admin with out-of-range autoApproveThreshold', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/gate/policies',
      headers: { authorization: `Bearer ${tokenFor('admin')}` },
      payload: { scope: '*', approversRequired: 1, autoApproveThreshold: 1.5 },
    })
    expect(res.statusCode).toBe(400)
  })
})
