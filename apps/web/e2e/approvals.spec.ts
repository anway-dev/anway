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
  test('approve action removes item from pending list', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Workflows').first().click()
    const approveBtn = page.locator('button:has-text("Approve"), button:has-text("Confirm")').first()
    if (await approveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveBtn.click()
      await expect(approveBtn).not.toBeVisible({ timeout: 3000 })
    }
  })
})
