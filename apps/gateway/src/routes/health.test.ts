import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../app.js'
import { initMetrics } from '../metrics.js'
import { beginDraining } from '../lifecycle.js'

process.env['JWT_SECRET'] = 'test-secret'

let app: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  initMetrics()
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

describe('GET /health/ready — draining', () => {
  it('returns 503 with status draining once draining begins', async () => {
    // beginDraining flips the shared module-level flag; /health/ready must
    // short-circuit to 503 before touching the DB. Run last (mutates global state).
    beginDraining()
    const response = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(response.statusCode).toBe(503)
    const body = JSON.parse(response.body) as { status: string }
    expect(body.status).toBe('draining')
  })
})
