import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../app.js'
import { initMetrics } from '../../metrics.js'

process.env['JWT_SECRET'] = 'test-secret'
process.env['RATE_LIMIT_MAX'] = '3'

let app: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  initMetrics()
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

describe('rate-limit middleware', () => {
  it('allows requests under the limit', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.statusCode).toBe(200)
  })

  it('rejects with 429 once limit is exceeded', async () => {
    // RATE_LIMIT_MAX=3 set above — exhaust with 3 requests, then expect 429
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/health' }).catch(() => {})
    }
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.statusCode).toBe(429)
  })
})
