import { test, expect } from '@playwright/test'
import { GATEWAY, DEMO_TENANT, authHeaders } from './fixtures'

test.describe('Connectors API — GET /api/connectors', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/connectors`)
    expect(resp.status()).toBe(401)
  })

  test('returns array with auth', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/connectors`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown
    expect(Array.isArray(body)).toBe(true)
  })
})

test.describe('Connectors API — GET /api/connectors/:type/bootstrap-status', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/connectors/github/bootstrap-status`)
    expect(resp.status()).toBe(401)
  })

  test('returns status object with auth', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/connectors/github/bootstrap-status`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { bootstrapped: boolean }
    expect(typeof body.bootstrapped).toBe('boolean')
  })
})

test.describe('Connectors API — POST /api/connectors/:type/bootstrap', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/connectors/github/bootstrap`)
    expect(resp.status()).toBe(401)
  })

  test('returns 400 for unknown connector type', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/connectors/not-a-real-connector/bootstrap`, { headers: h })
    expect(resp.status()).toBe(400)
  })

  test('returns 200 for valid connector type', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/connectors/github/bootstrap`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

test.describe('Connectors API — DELETE /api/connectors/:id', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.delete(`${GATEWAY}/api/connectors/00000000-0000-0000-0000-000000000001`)
    expect(resp.status()).toBe(401)
  })

  test('returns 400 for malformed UUID', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.delete(`${GATEWAY}/api/connectors/not-a-uuid`, { headers: h })
    expect(resp.status()).toBe(400)
  })

  test('returns 404 for non-existent connector', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.delete(`${GATEWAY}/api/connectors/00000000-0000-0000-0000-000000000099`, { headers: h })
    expect(resp.status()).toBe(404)
  })
})

test.describe('Connectors API — POST /api/connectors/:type/reconnect', () => {
  test('returns 401 without auth', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/connectors/github/reconnect`)
    expect(resp.status()).toBe(401)
  })

  test('returns 400 for unknown connector type', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/connectors/bad-type/reconnect`, { headers: h })
    expect(resp.status()).toBe(400)
  })

  test('returns 200 for valid connector type', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.post(`${GATEWAY}/api/connectors/k8s/reconnect`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
