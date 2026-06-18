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
    // Use unique target so we can identify this specific gate in the UI
    const uniqueTarget = `e2e-${Date.now()}`
    const h2 = await authHeaders2(request)
    const seedResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...h2, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: uniqueTarget, requestedBy: 'e2e-test' },
    })
    expect([200, 201]).toContain(seedResp.status())

    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Approvals').first().click()
    // Find the specific gate row by its unique description
    const gateDesc = `deploy — ${uniqueTarget}`
    await expect(page.locator(`text=${gateDesc}`).first()).toBeVisible({ timeout: 8000 })
    const beforeCount = await page.locator('button:has-text("Approve")').count()
    // Click the Approve button in the row for our specific gate
    await page.locator(`text=${gateDesc}`).first().locator('..').locator('..').locator('button:has-text("Approve")').click()
    // Count should decrease after approval
    await page.waitForTimeout(1000)
    const afterCount = await page.locator('button:has-text("Approve")').count()
    expect(afterCount).toBeLessThan(beforeCount)
  })
})
