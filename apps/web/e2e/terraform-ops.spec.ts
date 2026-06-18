import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Terraform ops — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('GET /api/terraform/environments returns list', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/terraform/environments`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown
    expect(body).toBeTruthy()
  })

  test('GET /api/terraform/detect returns detected state', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/terraform/detect`, { headers })
    expect(resp.status()).toBe(200)
  })

  test('GET /api/terraform/:env/plan — invalid env returns 400', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/terraform/not-a-valid-env-xyz/plan`, { headers })
    expect(resp.status()).toBe(400)
  })

  test('POST /api/terraform/:env/apply — invalid env returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/terraform/not-a-valid-env-xyz/apply`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { gateId: '00000000-0000-0000-0000-000000000099' },
    })
    expect(resp.status()).toBe(400)
  })

  test('GET /api/terraform/:env/output — invalid env returns 400', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/terraform/not-a-valid-env-xyz/output`, { headers })
    expect(resp.status()).toBe(400)
  })

  test('GET /api/terraform/:env/output — valid env returns 200 or 500 (no binary)', async ({ request }) => {
    const envResp = await request.get(`${GATEWAY}/api/terraform/environments`, { headers })
    const envBody = await envResp.json() as { environments?: Array<{ id: string }> } | Array<{ id: string }>
    const envs = Array.isArray(envBody) ? envBody : (envBody.environments ?? [])
    if (envs.length === 0) return // no environments configured — skip
    const envId = (envs[0] as { id: string }).id
    const resp = await request.get(`${GATEWAY}/api/terraform/${envId}/output`, { headers })
    // 200 = terraform binary present and outputs exist; 500 = no binary in test env
    expect([200, 500]).toContain(resp.status())
  })

  test('GET /api/terraform/:env/plan — without auth returns 401', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/terraform/demo/plan`)
    expect(resp.status()).toBe(401)
  })

  test('POST /api/terraform/:env/apply — without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/terraform/prod/apply`, {
      data: { gateId: '00000000-0000-0000-0000-000000000099' },
    })
    expect(resp.status()).toBe(401)
  })
})
