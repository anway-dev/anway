import { setAuthCookie, authHeaders, GATEWAY } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('Lifecycle — UI', () => {
  test('P0: navigate to Lifecycle — view loaded', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    // "Feature Lifecycle" header is always visible once loaded
    await expect(page.locator('text=Feature Lifecycle').first()).toBeVisible({ timeout: 8000 })
    // With data in DB, PRD stage card renders — use exact match to avoid hidden <option> elements
    await expect(
      page.getByText('PRD', { exact: true }).or(page.locator('text=No features yet')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P0: multiple stage labels visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await page.locator('text=Feature Lifecycle').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Tech Spec').or(page.locator('text=Deployment')).or(page.locator('text=Metrics')).or(page.locator('text=No features yet')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: click PRD stage — no JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Lifecycle').first().click()
    await page.locator('text=Feature Lifecycle').first().waitFor({ timeout: 8000 })
    const prdCard = page.getByText('PRD', { exact: true }).first()
    if (await prdCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prdCard.click()
    }
    await expect(
      page.locator('text=Feature Lifecycle').or(page.locator('text=No features yet')).first()
    ).toBeVisible({ timeout: 3000 })
    expect(errors).toHaveLength(0)
  })
})

test.describe('Lifecycle chain — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('POST /api/lifecycle/bootstrap — missing techspecId returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/lifecycle/bootstrap`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(resp.status()).toBe(400)
    const body = await resp.json() as { error: string }
    expect(body.error).toContain('techspecId')
  })

  test('POST /api/lifecycle/bootstrap — non-existent techspecId returns 404', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/lifecycle/bootstrap`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { techspecId: '00000000-0000-0000-0000-000000000099' },
    })
    // 404 = techspec not found; 503 = no LLM provider — both valid in test env
    expect([404, 503]).toContain(resp.status())
  })

  test('POST /api/lifecycle/testplan — missing techspecId returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/lifecycle/testplan`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(resp.status()).toBe(400)
    const body = await resp.json() as { error: string }
    expect(body.error).toContain('techspecId')
  })

  test('POST /api/lifecycle/testplan — non-existent techspecId returns 404', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/lifecycle/testplan`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { techspecId: '00000000-0000-0000-0000-000000000099' },
    })
    expect([404, 503]).toContain(resp.status())
  })

  test('POST /api/lifecycle/regression-test — missing incident returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/lifecycle/regression-test`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {},
    })
    expect(resp.status()).toBe(400)
    const body = await resp.json() as { error: string }
    expect(body.error).toContain('incident')
  })

  test('POST /api/lifecycle/regression-test — with incident string returns 200, 502, or 503', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/lifecycle/regression-test`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { incident: 'payments-api checkout timeouts at high load' },
    })
    // 200 = LLM provider configured; 502 = LLM error; 503 = no provider configured
    expect([200, 502, 503]).toContain(resp.status())
  })

  test('GET /api/lifecycle/artifacts returns array', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/lifecycle/artifacts`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})
