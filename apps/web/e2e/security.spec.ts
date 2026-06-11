import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Security surface', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('SSRF block — 127.0.0.1 models fetch returns empty', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://127.0.0.1:9090`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { models: unknown[] }
    expect(body.models).toHaveLength(0)
  })

  test('SSRF block — localhost models fetch returns empty', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://localhost:9090`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { models: unknown[] }
    expect(body.models).toHaveLength(0)
  })

  test('SSRF block — 169.254.x.x returns empty', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://169.254.169.254:9090`, { headers })
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
    expect(body).not.toMatch(/"credentials"\s*:/)
  })
})

test.describe('Cross-tenant', () => {
  test('x-tenant-id header ignored — server uses JWT tenantId', async ({ request }) => {
    const h = await authHeaders(request)
    // Own audit — baseline
    const ownResp = await request.get(`${GATEWAY}/api/audit`, { headers: h })
    expect(ownResp.status()).toBe(200)
    // Send a different tenant ID in header — gateway IGNORES this header, uses JWT claim
    // Server must return 200 (our own data, not an error, not the other tenant's data)
    const crossResp = await request.get(`${GATEWAY}/api/audit`, {
      headers: { ...h, 'x-tenant-id': '00000000-0000-0000-0000-000000000002' },
    })
    expect(crossResp.status()).toBe(200)
    // Response body must NOT contain the spoofed tenant's ID — our data only
    const body = JSON.stringify(await crossResp.json())
    expect(body).not.toContain('00000000-0000-0000-0000-000000000002')
  })
})

test.describe('Injection — incident API', () => {
  let headers: Record<string, string>
  const createdIds: string[] = []
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })
  test.afterEach(async ({ request }) => {
    for (const id of createdIds) {
      await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers }).catch(() => {})
    }
    createdIds.length = 0
  })

  test('P0: SQL injection in incident title stored safely', async ({ request }) => {
    const title = "E2E-SQL-'; DROP TABLE incidents; --"
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers, data: { title, severity: 'low' },
    })
    expect([200, 201]).toContain(resp.status())
    const { id } = await resp.json() as { id: string }
    createdIds.push(id)
    const getResp = await request.get(`${GATEWAY}/api/incidents/${id}`, { headers })
    expect(getResp.status()).toBe(200)
    expect((await getResp.json() as { title: string }).title).toBe(title)
  })

  test('P0: XSS payload in title — sanitized, must not contain raw script tag', async ({ request }) => {
    const title = 'E2E-XSS-<script>alert(1)</script>'
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers, data: { title, severity: 'low' },
    })
    expect([200, 201]).toContain(resp.status())
    const { id } = await resp.json() as { id: string }
    createdIds.push(id)
    const text = await (await request.get(`${GATEWAY}/api/incidents/${id}`, { headers })).text()
    // XSS sanitization: script tags must be stripped
    expect(text, 'XSS payload must be sanitized').not.toContain('<script>')
  })

  test('P1: SSRF block — 10.x private IP returns empty models', async ({ request }) => {
    const resp = await request.get(
      `${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://10.0.0.1:9090`,
      { headers },
    )
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { models: unknown[] }).models).toHaveLength(0)
  })

  test('P1: SSRF block — 192.168.x returns empty models', async ({ request }) => {
    const resp = await request.get(
      `${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://192.168.1.1:9090`,
      { headers },
    )
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { models: unknown[] }).models).toHaveLength(0)
  })

  test('P1: SSRF block — decimal-encoded 127.0.0.1 returns empty models', async ({ request }) => {
    const resp = await request.get(
      `${GATEWAY}/api/settings/models?provider=openai&baseUrl=http://2130706433:9090`,
      { headers },
    )
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { models: unknown[] }).models).toHaveLength(0)
  })
})
