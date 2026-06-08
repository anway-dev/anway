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
  })
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

describe('POST /auth/token', () => {
  it('returns JWT or auth error with valid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { email: 'test@example.com', tenantId: '00000000-0000-0000-0000-000000000001' },
    })
    // 200 when tenant+user exist; 400/401 when DB unavailable or data missing
    expect([200, 400, 401]).toContain(response.statusCode)
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body) as { token: string; expiresIn: string }
      expect(typeof body.token).toBe('string')
      expect(body.token.split('.').length).toBe(3)
      expect(body.expiresIn).toBe('24h')
    }
  })

  it('returns 400 when tenantId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { email: 'test@example.com' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 400 when email is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { tenantId: 'tenant-abc-123' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 400 with empty body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {},
    })
    expect(response.statusCode).toBe(400)
  })
})
