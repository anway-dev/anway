import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Provider Config', () => {
  test('P0: SSRF block returns empty models', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://localhost:9090`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { models: unknown[] }
    expect(body.models).toHaveLength(0)
  })

  test('P0: provider manifests returns list', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/provider-manifests`)
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})
