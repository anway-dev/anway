import { setAuthCookie, authHeaders, GATEWAY } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('War Room — UI', () => {
  test('P0: navigate to War Room — view loaded', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=War Room').first().click()
    await expect(page.locator('text=War Room').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: incident list or empty state visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=War Room').first().click()
    await page.locator('text=War Room').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=No incidents').or(page.locator('button:has-text("Investigate")')).or(page.locator('text=critical')).or(page.locator('text=high')).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('P1: no JS errors on War Room load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=War Room').first().click()
    await page.locator('text=War Room').first().waitFor({ timeout: 8000 })
    expect(errors).toHaveLength(0)
  })

  test('P1: incident with status badge visible or empty state', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=War Room').first().click()
    await page.locator('text=War Room').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=open').or(page.locator('text=resolved')).or(page.locator('text=No incidents')).first()
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('War Room — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test('GET /api/incidents returns paginated list', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/incidents`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as { data: unknown[]; nextCursor: string | null }
    expect(Array.isArray(body.data)).toBe(true)
  })

  test('POST /api/incidents creates incident — PATCH updates it', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { title: 'e2e-war-room-test', severity: 'low' },
    })
    expect([200, 201]).toContain(createResp.status())
    const { id } = await createResp.json() as { id: string }
    expect(id).toBeTruthy()

    // PATCH — update status to investigating
    const patchResp = await request.patch(`${GATEWAY}/api/incidents/${id}`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { status: 'investigating' },
    })
    expect([200, 204]).toContain(patchResp.status())

    // Resolve
    const resolveResp = await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers })
    expect([200, 204]).toContain(resolveResp.status())
  })

  test('GET /api/incidents/:id returns single incident', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { title: 'e2e-war-room-get-test', severity: 'low' },
    })
    const { id } = await createResp.json() as { id: string }
    const getResp = await request.get(`${GATEWAY}/api/incidents/${id}`, { headers })
    expect(getResp.status()).toBe(200)
    const body = await getResp.json() as { id: string; title: string }
    expect(body.id).toBe(id)
    expect(body.title).toBe('e2e-war-room-get-test')
    // cleanup
    await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers })
  })
})
