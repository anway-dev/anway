import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Provider Config — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('P0: GET /api/settings/provider-manifests returns array with anthropic + openai', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/provider-manifests`)
    expect(resp.status()).toBe(200)
    const body = await resp.json() as Array<{ id: string; displayName: string; fields: unknown[] }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    body.forEach(m => {
      expect(m.id).toBeTruthy()
      expect(m.displayName).toBeTruthy()
      expect(Array.isArray(m.fields)).toBe(true)
    })
    const ids = body.map(m => m.id)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('openai')
  })

  test('P0: GET /api/settings/provider returns configured boolean', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/provider`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { configured: boolean }
    expect(typeof body.configured).toBe('boolean')
  })

  test('P0: POST /api/settings/provider with invalid provider returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/settings/provider`, {
      headers, data: { provider: 'invalid-xyz' },
    })
    expect(resp.status()).toBe(400)
  })

  test('P0: POST /api/settings/provider round-trip — saves and GET reflects it', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/settings/provider`, {
      headers, data: { provider: 'anthropic', defaultModel: 'claude-sonnet-4-6' },
    })
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { ok: boolean }).ok).toBe(true)
    const getResp = await request.get(`${GATEWAY}/api/settings/provider`, { headers })
    const getBody = await getResp.json() as { configured: boolean; provider?: string }
    expect(getBody.configured).toBe(true)
    expect(getBody.provider).toBe('anthropic')
  })

  test('P1: GET /api/settings/models for anthropic returns non-empty list', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=anthropic`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { models: string[] }
    expect(Array.isArray(body.models)).toBe(true)
    expect(body.models.length).toBeGreaterThan(0)
  })

  test('P1: SSRF block — 127.0.0.1 baseUrl returns empty models', async ({ request }) => {
    const resp = await request.get(
      `${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://127.0.0.1:9090`,
      { headers },
    )
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { models: unknown[] }).models).toHaveLength(0)
  })
})

test.describe('Provider Config — UI', () => {
  test('P1: Settings — Configuration heading + AI Provider tab visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Settings').first().click()
    await expect(page.locator('text=Configuration').first()).toBeVisible({ timeout: 8000 })
    await expect(page.locator('button:has-text("AI Provider")').or(page.locator('text=AI Provider')).first()).toBeVisible({ timeout: 5000 })
  })
})
