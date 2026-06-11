import { test, expect } from '@playwright/test'
import { GATEWAY, DEMO_TENANT, authHeaders } from './fixtures'

test.describe('Approvals', () => {
  let token: string
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
    token = headers['authorization']?.replace('Bearer ', '') ?? ''
  })

  test('gate decide on non-existent gate returns 404', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000099/decide`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(resp.status()).toBe(404)
  })

  test('gate decide without JWT returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000001/decide`, {
      data: { decision: 'approved' },
    })
    expect(resp.status()).toBe(401)
  })
})

test.describe('Approvals UI', () => {
  test('approve action removes item from pending list', async ({ page, request }) => {
    const h = await authHeaders(request)
    // Seed a gate
    const seedResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: 'payments-api', requestedBy: 'e2e-test' },
    })
    expect(seedResp.status()).toBe(201)
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    // After seeding, at least one pending approval should exist
    const approveBtn = page.locator('button:has-text("Approve"), button:has-text("Confirm")').first()
    await expect(approveBtn).toBeVisible({ timeout: 5000 })
    await approveBtn.click()
    await expect(approveBtn).not.toBeVisible({ timeout: 5000 })
  })
})
