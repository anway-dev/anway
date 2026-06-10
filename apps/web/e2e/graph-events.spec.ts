import { test, expect } from '@playwright/test'
import { GATEWAY, DEMO_TENANT } from './fixtures'

test.describe('Graph Events', () => {
  test('POST /api/graph/events without connector key returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/graph/events`, {
      data: { type: 'pr_merged', tenantId: DEMO_TENANT },
    })
    expect(resp.status()).toBe(401)
  })
})
