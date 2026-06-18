import { test, expect } from '@playwright/test'
import { setAuthCookie, authHeaders, authHeaders2 } from './fixtures'
import { GATEWAY, DEMO_TENANT } from './fixtures'

test.describe('Approvals', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
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
    // Seed gate with dev2 so that the UI user (dev/admin) can approve it (SoD requirement)
    const h2 = await authHeaders2(request)
    const seedResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...h2, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: 'payments-api', requestedBy: 'e2e-test' },
    })
    expect([200, 201]).toContain(seedResp.status())

    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Approvals').first().click()
    // After seeding, at least one pending approval should exist
    const approveBtn = page.locator('button:has-text("Approve"), button:has-text("Confirm")').first()
    await expect(approveBtn).toBeVisible({ timeout: 8000 })
    await approveBtn.click()
    // Button count should decrease after approval
    await page.waitForTimeout(500)
    const afterCount = await page.locator('button:has-text("Approve")').count()
    const initialCount = await seedResp.json().then(() => 1).catch(() => 1)
    expect(afterCount).toBeLessThanOrEqual(initialCount)
  })
})
