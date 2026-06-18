/**
 * Input validation edge cases across all routes.
 * Verifies the gateway rejects malformed inputs safely (no 500s, no crashes).
 */
import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('UUID validation', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('GET /api/incidents/not-a-uuid returns 400 or 404', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/incidents/not-a-uuid`, { headers })
    expect([400, 404]).toContain(resp.status())
  })

  test('GET /api/gate/not-a-uuid returns 400', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/gate/not-a-uuid`, { headers })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/gate/not-a-uuid/decide returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/gate/not-a-uuid/decide`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    expect(resp.status()).toBe(400)
  })

  test('GET /api/access/users/not-a-uuid/perimeter returns 400', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/access/users/not-a-uuid/perimeter`, { headers })
    expect(resp.status()).toBe(400)
  })

  test('GET /api/sessions/not-a-uuid/turns returns 200, 400, or 404 (sessions accept text IDs)', async ({ request }) => {
    // Sessions intentionally accept both UUID and text IDs (text session IDs are supported
    // for in-flight sessions). A non-UUID returns 200 with empty turns, not 400.
    const resp = await request.get(`${GATEWAY}/api/sessions/not-a-uuid/turns`, { headers })
    expect([200, 400, 404]).toContain(resp.status())
  })
})

test.describe('Schema validation — required fields', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('POST /api/incidents without title returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { severity: 'low' },
    })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/gate with missing target returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { action: 'deploy' },
    })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/gate/decide with invalid decision value returns 400', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000099/decide`,
      {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: { decision: 'maybe' },
      },
    )
    expect(resp.status()).toBe(400)
  })

  test('PUT /api/gate/policies with autoApproveThreshold=1.5 returns 400', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/gate/policies`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { scope: '*', approversRequired: 1, autoApproveThreshold: 1.5 },
    })
    expect(resp.status()).toBe(400)
  })

  test('PUT /api/gate/policies with approversRequired=0 returns 400', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/gate/policies`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { scope: '*', approversRequired: 0, autoApproveThreshold: 0.95 },
    })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/chat without query returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { sessionId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/chat without sessionId returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/chat`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { query: 'test' },
    })
    expect(resp.status()).toBe(400)
  })
})

test.describe('Oversized input protection', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('PUT /api/access/users/:id/perimeter with 51 perimeter items returns 400', async ({ request }) => {
    const perimeter = Array.from({ length: 51 }, (_, i) => ({
      connectorName: `connector-${i}`,
      readScopes: ['*'],
      writeScopes: [],
    }))
    const resp = await request.put(
      `${GATEWAY}/api/access/users/00000000-0000-0000-0000-000000000002/perimeter`,
      {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: { perimeter },
      },
    )
    expect(resp.status()).toBe(400)
  })

  test('POST /api/gate with very long target string returns 400 or truncates safely', async ({ request }) => {
    const longTarget = 'a'.repeat(10000)
    const resp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target: longTarget },
    })
    // Must not 500 — either 400 (validation) or 201 (stored, truncated)
    expect(resp.status()).not.toBe(500)
  })
})

test.describe('XSS / injection across endpoints', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('POST /api/gate XSS payload in target — stored and returned safely', async ({ request }) => {
    const target = '<script>alert(1)</script>'
    const resp = await request.post(`${GATEWAY}/api/gate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { action: 'deploy', target, requestedBy: 'e2e-xss' },
    })
    if (resp.status() === 201) {
      // Don't fetch pending list via HTML — check the JSON response doesn't execute
      const body = JSON.stringify(await resp.json())
      expect(body).not.toContain('<script>')
    } else {
      // 400 = input rejected — also acceptable
      expect([400, 201]).toContain(resp.status())
    }
  })

  test('POST /api/automations/triggers with SQL injection in name — stored safely', async ({ request }) => {
    const name = "test'; DROP TABLE triggers; --"
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        name,
        eventType: 'alert_fired',
        condition: { threshold: 0 },
        actions: [],
      },
    })
    if ([200, 201].includes(resp.status())) {
      const body = await resp.json() as { name: string; id: string }
      expect(body.name).toBe(name) // stored verbatim, not executed
      // cleanup
      await request.delete(`${GATEWAY}/api/automations/triggers/${body.id}`, { headers })
    } else {
      expect([400, 422]).toContain(resp.status())
    }
  })
})
