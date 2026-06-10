import { test, expect } from '@playwright/test'
import { GATEWAY } from './fixtures'

test.describe('Security surface', () => {
  test('SSRF block — 127.0.0.1 models fetch returns empty', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://127.0.0.1:9090`)
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { models: unknown[] }
    expect(body.models).toHaveLength(0)
  })

  test('SSRF block — localhost models fetch returns empty', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://localhost:9090`)
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { models: unknown[] }
    expect(body.models).toHaveLength(0)
  })

  test('SSRF block — 169.254.x.x returns empty', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://169.254.169.254:9090`)
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { models: unknown[] }
    expect(body.models).toHaveLength(0)
  })

  test('API key not in health response', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/health`)
    const text = await resp.text()
    expect(text).not.toContain('ANTHROPIC_API_KEY')
    expect(text).not.toContain('OPENAI_API_KEY')
  })

  test('JWT secret not exposed', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/health`)
    const text = await resp.text()
    expect(text).not.toContain('JWT_SECRET')
  })
})

test.describe('Security extended', () => {
  test('GET /api/connectors response does not include credentials', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/connectors`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = JSON.stringify(await resp.json())
    expect(body).not.toContain('config_encrypted')
    expect(body).not.toContain('credentials')
  })
})
