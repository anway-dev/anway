import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, setAuthCookie } from './fixtures'

test.describe('Connectors — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('P0: GET /api/connectors returns 200 array with id/name/type/mode', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/connectors`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as Array<{ id: string; name: string; type: string; mode: string }>
    expect(Array.isArray(body)).toBe(true)
    for (const c of body) {
      expect(c.id).toBeDefined()
      expect(c.name).toBeDefined()
      expect(c.type).toBeDefined()
      expect(c.mode).toBeDefined()
    }
  })

  test('P0: GET /api/connectors response has no credentials field', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/connectors`, { headers })
    const text = await resp.text()
    expect(text).not.toMatch(/"credentials"\s*:/)
  })

  test('P0: PUT /api/settings/connectors/github registers connector', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/settings/connectors/github`, {
      headers, data: { credentials: { token: 'ghp_e2etest', org: 'e2e-org' } },
    })
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { ok: boolean }).ok).toBe(true)
  })

  test('P0: PUT /api/settings/connectors/unknown-type returns 400', async ({ request }) => {
    const resp = await request.put(`${GATEWAY}/api/settings/connectors/nonexistent-xyz`, {
      headers, data: { credentials: {} },
    })
    expect(resp.status()).toBe(400)
  })

  test('P1: GET /api/settings/connectors returns array with no credentials', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/settings/connectors`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/"credentials"\s*:/)
  })

  test('P1: GET /api/connectors/:type/bootstrap-status returns bootstrapped field', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/connectors/github/bootstrap-status`, { headers })
    expect(resp.status()).toBe(200)
    expect(typeof (await resp.json() as { bootstrapped: boolean }).bootstrapped).toBe('boolean')
  })

  test('P1: POST /api/connectors/github/bootstrap returns ok', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/connectors/github/bootstrap`, { headers })
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { ok: boolean }).ok).toBe(true)
  })

  test('P1: POST /api/connectors/unknown/bootstrap returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/connectors/unknown-xyz/bootstrap`, { headers })
    expect(resp.status()).toBe(400)
  })
})

test.describe('Connectors — UI', () => {
  test('P0: navigate to Connectors — GitHub and Datadog cards visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Connectors').first().click()
    await expect(page.locator('text=GitHub').first()).toBeVisible({ timeout: 8000 })
    await expect(page.locator('text=Datadog').first()).toBeVisible({ timeout: 5000 })
  })

  test('P1: Observability category filter shows monitoring connectors', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Connectors').first().click()
    await page.locator('text=GitHub').first().waitFor({ timeout: 8000 })
    const obsBtn = page.locator('button:has-text("Observability")').first()
    if (await obsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await obsBtn.click()
      await expect(page.locator('text=Prometheus').or(page.locator('text=Datadog')).first()).toBeVisible({ timeout: 3000 })
    }
  })
})
