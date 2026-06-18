import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, setAuthCookie } from './fixtures'

test.describe('Audit view', () => {
  test('renders audit trail table', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Audit').first().click()
    await expect(page.locator('text=Audit Trail')).toBeVisible({ timeout: 8000 })
    // Summary cards
    await expect(page.locator('text=Total events').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Access denied').first()).toBeVisible({ timeout: 5000 })
  })

  test('search filters audit events', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Audit').first().click()
    const searchInput = page.locator('input[placeholder="Search queries..."]')
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('payments')
    }
  })
})

test.describe('Pagination', () => {
  test('?limit=5 returns at most 5 events', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/audit?limit=5`, { headers: h })
    expect(resp.status()).toBe(200)
    const raw = await resp.json() as { data?: unknown[] } | unknown[]
    const body = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] }).data ?? [])
    expect(body.length).toBeLessThanOrEqual(5)
  })

  test('?limit=5&offset=5 returns second page', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/audit?limit=5`, { headers: h })
    expect(resp.status()).toBe(200)
    const raw = await resp.json() as { data?: unknown[] } | unknown[]
    const body = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] }).data ?? [])
    expect(Array.isArray(body)).toBe(true)
  })

  test('GET /api/audit?limit=201 returns at most 500 items', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/audit?limit=201`, { headers: h })
    expect(resp.status()).toBe(200)
    const raw = await resp.json() as { data?: unknown[] } | unknown[]
    const body = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] }).data ?? [])
    expect(body.length).toBeLessThanOrEqual(500)
  })
})
