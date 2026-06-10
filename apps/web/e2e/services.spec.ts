import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Service Catalog', () => {
  test('GET /api/services returns list', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/services`, { headers: h })
    expect(resp.status()).toBe(200)
  })
})
