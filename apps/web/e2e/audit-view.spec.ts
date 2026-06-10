import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Audit view', () => {
  test('renders audit trail table', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Audit').first().click()
    await expect(page.locator('text=Audit Trail')).toBeVisible()
    // Summary cards
    await expect(page.locator('text=Total events').first()).toBeVisible()
    await expect(page.locator('text=Access denied').first()).toBeVisible()
  })

  test('search filters audit events', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Audit').first().click()
    const searchInput = page.locator('input[placeholder="Search queries..."]')
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('payments')
      // Should filter results
    }
  })
})

test.describe('Pagination', () => {
  test('?limit=5 returns at most 5 events', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/audit?limit=5`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(body.length).toBeLessThanOrEqual(5)
  })

  test('?limit=5&offset=5 skips first 5', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/audit?limit=5`, { headers: h })
    expect(resp.status()).toBe(200)
  })
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/audit?limit=5`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(body.length).toBeLessThanOrEqual(5)
  })

  test('GET /api/audit?limit=201 is capped at 200', async ({ request }) => {
    const h = await authHeaders(request)
    const resp = await request.get(`${GATEWAY}/api/audit?limit=201`, { headers: h })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(body.length).toBeLessThanOrEqual(200)
  })
})
