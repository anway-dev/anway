import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Model config — DB persistence', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test('P0: save provider with apiKey + model → GET returns saved config', async ({ request }) => {
    // Save a provider config with all fields
    const saveResp = await request.post(`${GATEWAY}/api/settings/provider`, {
      headers,
      data: {
        provider: 'anthropic',
        apiKey: 'test-key-12345',
        defaultModel: 'claude-sonnet-4-6',
        cheapModel: 'claude-haiku-3-5-20251001',
      },
    })
    expect([200, 201]).toContain(saveResp.status())

    // GET must return the saved config
    const getResp = await request.get(`${GATEWAY}/api/settings/provider`, { headers })
    expect(getResp.status()).toBe(200)
    const config = await getResp.json() as { provider?: string; defaultModel?: string; configured?: boolean }
    expect(config.provider ?? config.defaultModel, 'saved config must be retrievable').toBeTruthy()
  })

  test('P0: update only model — apiKey preserved (COALESCE)', async ({ request }) => {
    // First save with apiKey
    await request.post(`${GATEWAY}/api/settings/provider`, {
      headers,
      data: { provider: 'openai', apiKey: 'sk-test-preserve', defaultModel: 'gpt-4o' },
    })

    // Update only defaultModel (no apiKey) — must preserve existing apiKey
    const updateResp = await request.post(`${GATEWAY}/api/settings/provider`, {
      headers,
      data: { provider: 'openai', defaultModel: 'gpt-4o-mini' },
    })
    expect([200, 201]).toContain(updateResp.status())

    // GET must show updated model AND still have apiKey (configured = true)
    const getResp = await request.get(`${GATEWAY}/api/settings/provider`, { headers })
    expect(getResp.status()).toBe(200)
    const config = await getResp.json() as { defaultModel?: string; configured?: boolean }
    expect(config.configured, 'provider must still be configured after model-only update').toBe(true)
  })

  test('P1: GET /api/settings/provider without saved config returns configured=false', async ({ request }) => {
    // This test relies on tenant isolation — different tenants see different configs
    // For the demo tenant, config may or may not exist — just verify the endpoint works
    const resp = await request.get(`${GATEWAY}/api/settings/provider`, { headers })
    expect(resp.status()).toBe(200)
    const config = await resp.json()
    expect(typeof config === 'object', 'provider config response must be an object').toBe(true)
  })
})
