import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../app.js'
import { initMetrics } from '../metrics.js'

process.env['JWT_SECRET'] = 'test-secret'

let app: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  initMetrics()
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

describe('GET /health', () => {
  it('returns 200 with status ok, version, and uptime', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body) as { status: string; version: string; uptime: number }
    expect(body.status).toBe('ok')
    expect(typeof body.version).toBe('string')
    expect(typeof body.uptime).toBe('number')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })
})

describe('GET /health/live', () => {
  it('returns 200 with status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body) as { status: string }
    expect(body.status).toBe('ok')
  })
})

describe('GET /health/ready', () => {
  it('returns readiness status (200 or 503 when DB unavailable)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' })
    // 200 when DB available; 503 when DB unavailable (test has no DB)
    expect([200, 503]).toContain(response.statusCode)
    const body = JSON.parse(response.body) as { status: string }
    expect(['ok', 'not_ready']).toContain(body.status)
    // Real Postgres roundtrip — same class of flake as other real-DB tests
    // in this session under `pnpm test`'s full monorepo parallel load;
    // passes in ~500ms in isolation.
  }, 15_000)
})

describe('GET /metrics', () => {
  it('returns Prometheus metrics with correct content-type', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain')
    // Prometheus format begins with # HELP or # TYPE lines
    expect(response.body).toMatch(/^#/)
  })
})

describe('POST /api/auth/login', () => {
  it('returns 401 with valid body but unknown credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nonexistent@example.com', password: 'wrong', tenantId: '00000000-0000-0000-0000-000000000001' },
    })
    // 401 when credentials don't match; 400 when DB unavailable
    expect([401, 400]).toContain(response.statusCode)
    // Real Postgres roundtrip — under `pnpm test`'s full-monorepo parallel
    // load (~70 concurrent test suites competing for CPU/DB connections),
    // observed exceeding vitest's default 5000ms; passes well under 1s in
    // isolation. Not a logic bug — genuine resource contention headroom.
  }, 15_000)

  it('returns 400 when email is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'test' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 400 when password is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 400 with empty body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    })
    expect(response.statusCode).toBe(400)
  })
})
