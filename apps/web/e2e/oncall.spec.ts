import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Oncall — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('POST /api/oncall/shift-brief — missing teamName returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/oncall/shift-brief`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(resp.status()).toBe(400)
    const body = await resp.json() as { error: string }
    expect(body.error).toContain('teamName')
  })

  test('POST /api/oncall/shift-brief — with teamName returns 200, 502, or 503', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/oncall/shift-brief`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { teamName: 'platform' },
    })
    // 200 = LLM provider configured; 502 = LLM error; 503 = no provider configured
    expect([200, 502, 503]).toContain(resp.status())
  })

  test('POST /api/oncall/investigate — missing alertTitle returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/oncall/investigate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(resp.status()).toBe(400)
    const body = await resp.json() as { error: string }
    expect(body.error).toContain('alertTitle')
  })

  test('POST /api/oncall/investigate — with alertTitle returns 200, 502, or 503', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/oncall/investigate`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { alertTitle: 'payments-api error rate spike' },
    })
    expect([200, 502, 503]).toContain(resp.status())
  })

  test('POST /api/oncall/shift-brief — without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/oncall/shift-brief`, { data: {} })
    expect(resp.status()).toBe(401)
  })

  test('POST /api/oncall/investigate — without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/oncall/investigate`, { data: { alertId: 'x' } })
    expect(resp.status()).toBe(401)
  })
})
