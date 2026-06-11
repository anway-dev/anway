import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, uniqueId } from './fixtures'

test.describe('Orchestrator Chat — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('P0: POST /api/chat without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      data: { query: 'hello', sessionId: uniqueId('sess') },
    })
    expect(resp.status()).toBe(401)
  })

  test('P0: POST /api/chat with auth returns 200 or 503', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { query: 'hello', sessionId: uniqueId('sess') },
    })
    expect([200, 503]).toContain(resp.status())
  })

  test('P0: POST /api/chat missing query returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { sessionId: 'test' },
    })
    expect(resp.status()).toBe(400)
  })

  test('P0: POST /api/chat missing sessionId returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { query: 'hello' },
    })
    expect(resp.status()).toBe(400)
  })
})

test.describe('Orchestrator Chat — UI', () => {
  test('P0: default view is chat — input visible', async ({ page }) => {
    await page.goto('/')
    const input = page.locator('input[placeholder*="nvay"]').or(page.locator('textarea[placeholder*="nvay"]')).first()
    await expect(input).toBeVisible({ timeout: 5000 })
  })

  test('P0: scenario shortcut chips visible on load', async ({ page }) => {
    await page.goto('/')
    const chips = page.locator('button').filter({ hasText: /alert|deploy|why|incident/i })
    expect(await chips.count()).toBeGreaterThanOrEqual(2)
  })

  test('P1: type in chat input and submit', async ({ page }) => {
    await page.goto('/')
    const input = page.locator('input[placeholder*="nvay"]').or(page.locator('textarea[placeholder*="nvay"]')).first()
    await expect(input).toBeVisible({ timeout: 5000 })
    const query = 'test query ' + uniqueId('')
    await input.fill(query)
    await input.press('Enter')
    await expect(page.locator('text=' + query).first()).toBeVisible({ timeout: 8000 })
  })
})
