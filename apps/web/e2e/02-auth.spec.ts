import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Auth — API', () => {
  // dev-token was a real, working endpoint under an earlier auth model. It was
  // deliberately removed — the web app must not be able to self-authenticate
  // (see e2e/99-certification.spec.ts CERT I.0, which already certifies this
  // exact 404 as correct). These two tests were never updated after that
  // removal and asserted the old, insecure behavior should still work.
  test('P0: GET /api/auth/dev-token no longer exists (removed for security)', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/auth/dev-token`)
    expect(resp.status()).toBe(404)
  })

  test('P0: GET /api/incidents without auth returns 401', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/incidents`)
    expect(resp.status()).toBe(401)
  })

  test('P0: GET /api/incidents with malformed token returns 401', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/incidents`, {
      headers: { Authorization: 'Bearer invalid-token' },
    })
    expect(resp.status()).toBe(401)
  })

  test('P0: unknown route returns 404 not 401', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/nonexistent-route-xyz`)
    expect(resp.status()).toBe(404)
  })
})

test.describe('Auth session lifecycle', () => {
  test('POST /api/auth/refresh returns new token', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/auth/refresh`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { token: string; expiresIn: string }
    expect(body.token).toBeTruthy()
    expect(body.expiresIn).toBe('24h')
    // New token must be a valid JWT (3 parts)
    expect(body.token.split('.').length).toBe(3)
  })

  test('POST /api/auth/refresh without JWT returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/auth/refresh`)
    expect(resp.status()).toBe(401)
  })

  test('POST /api/auth/logout returns ok', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/auth/logout`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test('POST /api/auth/logout without JWT returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/auth/logout`)
    expect(resp.status()).toBe(401)
  })
})
