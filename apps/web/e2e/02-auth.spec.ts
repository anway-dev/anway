import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Auth — API', () => {
  test('P0: GET /api/auth/dev-token returns 200 with token + tenantId', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/auth/dev-token`)
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { token: string; tenantId: string }
    expect(body.token).toBeTruthy()
    expect(body.tenantId).toBeTruthy()
  })

  test('P0: dev-token JWT has required claims', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/auth/dev-token`)
    const body = await resp.json() as { token: string }
    const parts = body.token.split('.')
    expect(parts.length).toBe(3)
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
    expect(payload.sub).toBeTruthy()
    expect(payload.email).toBeTruthy()
    expect(payload.tenantId).toBeTruthy()
    expect(payload.role).toBeTruthy()
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
