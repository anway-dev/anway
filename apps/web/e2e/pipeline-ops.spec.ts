import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Pipeline ops — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('POST /api/pipelines/runs/:runId/cancel — non-existent run returns 404', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/pipelines/runs/00000000-0000-0000-0000-000000000099/cancel`,
      { headers: { ...headers, 'Content-Type': 'application/json' }, data: {} },
    )
    expect(resp.status()).toBe(404)
  })

  test('POST /api/pipelines/:id/stages/:stageId/approve — non-existent stage returns 404 or 409', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/pipelines/00000000-0000-0000-0000-000000000099/stages/00000000-0000-0000-0000-000000000099/approve`,
      { headers: { ...headers, 'Content-Type': 'application/json' }, data: {} },
    )
    expect([404, 409]).toContain(resp.status())
  })

  test('POST /api/pipelines — creates pipeline', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/pipelines`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { name: 'e2e-test-pipeline', stages: [{ name: 'build', type: 'build' }] },
    })
    expect([200, 201]).toContain(resp.status())
    const body = await resp.json() as { id: string }
    expect(body.id).toBeTruthy()
  })

  test('GET /api/pipelines returns list', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/pipelines`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { data?: unknown[]; pipelines?: unknown[] } | unknown[]
    const list = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? (body as { pipelines?: unknown[] }).pipelines ?? [])
    expect(Array.isArray(list)).toBe(true)
  })

  test('POST /api/pipelines/runs/:runId/cancel — without auth returns 401', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/pipelines/runs/00000000-0000-0000-0000-000000000099/cancel`,
      { data: {} },
    )
    expect(resp.status()).toBe(401)
  })

  test('POST /api/pipelines/:id/stages/:stageId/approve — without auth returns 401', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/pipelines/00000000-0000-0000-0000-000000000099/stages/s1/approve`,
      { data: { decision: 'approved' } },
    )
    expect(resp.status()).toBe(401)
  })
})
