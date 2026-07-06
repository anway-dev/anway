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

// /health and /metrics are deliberately exempt from the global rate limit
// (app.ts's allowList — k8s liveness/readiness probes and the Prometheus
// scraper hit them constantly from a shared-IP ingress, and throttling them
// makes the orchestrator think healthy pods are unhealthy). This test
// previously asserted /health itself gets rate-limited, which was the
// pre-fix behavior the allowList exemption was written to eliminate — it
// was testing the bug, not the fix. /api/auth/methods is a real, non-exempt,
// unauthenticated GET route, so it's used here instead to verify the
// limiter still does its job on routes that are actually supposed to be
// throttled.
describe('rate-limit middleware', () => {
  it('allows requests under the limit', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(r.statusCode).toBe(200)
  })

  it('rejects with 429 once limit is exceeded on a non-exempt route', async () => {
    // RATE_LIMIT_MAX=3 set above — exhaust with 3 requests, then expect 429
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/api/auth/methods' }).catch(() => {})
    }
    const r = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(r.statusCode).toBe(429)
  })

  it('never rate-limits /health even after the limit is exhausted', async () => {
    // Exhaust the same per-IP budget via a non-exempt route first...
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'GET', url: '/api/auth/methods' }).catch(() => {})
    }
    // ...then confirm /health is still untouched by the limiter.
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.statusCode).toBe(200)
  })
})
