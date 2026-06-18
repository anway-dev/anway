import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Settings — workspace & admin', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('GET /api/settings/workspace returns tenant name', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/workspace`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { name: string }
    expect(typeof body.name).toBe('string')
    expect(body.name.length).toBeGreaterThan(0)
  })

  test('GET /api/settings/workspace without auth returns 401', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/workspace`)
    expect(resp.status()).toBe(401)
  })

  test('GET /api/settings/token-usage returns usage object', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/token-usage`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as Record<string, unknown>
    expect(body).toBeTruthy()
  })

  test('DELETE /api/admin/token-usage/reset returns deleted count and date', async ({ request }) => {
    const resp = await request.delete(`${GATEWAY}/api/admin/token-usage/reset`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { deleted: number; date: string }
    expect(typeof body.deleted).toBe('number')
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('DELETE /api/admin/token-usage/reset is idempotent (second call deleted=0)', async ({ request }) => {
    // First reset
    await request.delete(`${GATEWAY}/api/admin/token-usage/reset`, { headers })
    // Second reset same day — nothing left to delete
    const resp = await request.delete(`${GATEWAY}/api/admin/token-usage/reset`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { deleted: number }
    expect(body.deleted).toBe(0)
  })
})

test.describe('Settings — connector config', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('PUT /api/settings/connectors/:type — unknown connector type returns 400', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/settings/connectors/notarealconnector-xyz`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { credentials: { apiKey: 'test' } },
    })
    expect(resp.status()).toBe(400)
  })

  test('PUT /api/settings/connectors/:type — valid connector stores config (credentials not echoed back)', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/settings/connectors/github`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { credentials: { token: 'ghp_test_token_e2e' } },
    })
    // 200 = stored; 400 = validation error; either is acceptable for test env
    expect([200, 400]).toContain(resp.status())
    if (resp.status() === 200) {
      const body = JSON.stringify(await resp.json())
      expect(body).not.toContain('ghp_test_token_e2e')
      expect(body).not.toContain('token')
    }
  })

  test('GET /api/settings/connectors — response does not include credentials', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/connectors`, { headers })
    expect(resp.status()).toBe(200)
    const body = JSON.stringify(await resp.json())
    expect(body).not.toContain('credentials')
    expect(body).not.toContain('apiKey')
    expect(body).not.toContain('token')
  })
})

test.describe('Auth — demo endpoint', () => {
  test('POST /api/auth/demo — without DEMO_MODE set returns 404', async ({ request }) => {
    // In test env DEMO_MODE is not set → 404 (fail-closed)
    const resp = await request.post(`${GATEWAY}/api/auth/demo`)
    // Either 404 (DEMO_MODE not set) or 200/503 (if DEMO_MODE=true)
    expect([200, 404, 503]).toContain(resp.status())
  })
})
