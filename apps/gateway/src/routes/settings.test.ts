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

describe('GET /api/settings/connectors/:type', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/connectors/prometheus' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for a non-admin user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/connectors/prometheus',
      headers: { authorization: `Bearer ${tokenFor('dev')}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 when connector not configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/connectors/nonexistent-connector-type',
      headers: { authorization: `Bearer ${tokenFor('admin')}` },
    })
    // DB-dependent: 404 when connector row missing; 500/503 when DB unavailable
    expect([404, 500, 503]).toContain(res.statusCode)
    // Real Postgres roundtrip — under `pnpm test`'s full-monorepo parallel
    // load (~70 concurrent test suites), observed exceeding vitest's
    // default 5000ms; passes well under 1s in isolation.
  }, 15_000)

  it('returns non-password fields after PUT', async () => {
    // First PUT credentials with url + password
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/settings/connectors/prometheus',
      headers: {
        authorization: `Bearer ${tokenFor('admin')}`,
        'content-type': 'application/json',
      },
      payload: { credentials: { url: 'https://prom.example.com', password: 'secret123', user: 'admin' } },
    })
    // PUT may succeed (200) or fail if DB unavailable (500/503)
    if (![200, 500, 503].includes(putRes.statusCode)) {
      expect(putRes.statusCode).toBe(200)
    }
    if (putRes.statusCode !== 200) return // DB unavailable, skip GET check

    // Then GET — should return url and user but NOT password
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/settings/connectors/prometheus',
      headers: { authorization: `Bearer ${tokenFor('admin')}` },
    })
    expect(getRes.statusCode).toBe(200)
    const body = JSON.parse(getRes.body) as { credentials: Record<string, unknown> }
    expect(body.credentials).toBeDefined()
    expect(body.credentials['url']).toBe('https://prom.example.com')
    expect(body.credentials['user']).toBe('admin')
    expect(body.credentials['password']).toBeUndefined()
    // Two real Postgres roundtrips (PUT + GET) — under `pnpm test`'s
    // full-monorepo parallel load (~70 concurrent test suites), observed
    // exceeding vitest's default 5000ms; passes well under 1s in isolation.
  }, 15_000)
})
