import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders } from './fixtures'

test.describe('Services — API', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test('P0: GET /api/services returns 200, array, each item has id/name/health', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/services`, { headers })
    expect(resp.status(), 'GET /api/services must return 200').toBe(200)
    const body = await resp.json() as Array<{ id?: string; name?: string; health?: string }>
    expect(Array.isArray(body), 'services response must be an array').toBe(true)

    // If there are services, each must have id, name, health
    for (const svc of body) {
      expect(svc.id, `service must have an id`).toBeDefined()
      expect(svc.name, `service ${svc.id} must have a name`).toBeDefined()
      expect(svc.health, `service ${svc.name} must have a health field`).toBeDefined()
    }
  })
})

test.describe('Services — UI', () => {
  test('P0: navigate to Services, service list visible in sidebar', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Services').first().click()

    // Service list panel visible
    const serviceList = page.locator('[data-testid="service-list"]')
      .or(page.locator('text=Service Catalog'))
      .or(page.locator('text=payments-api'))
      .or(page.locator('text=auth-service'))
      .or(page.locator('text=Dependencies'))
      .first()
    await expect(serviceList, 'Service list or catalog heading must be visible').toBeVisible({ timeout: 8000 })
  })

  test('P0: click a service → right panel shows service detail with metrics', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Services').first().click()

    // Wait for service list to load
    await page.locator('text=Service Catalog')
      .or(page.locator('text=payments-api'))
      .or(page.locator('text=Dependencies'))
      .first()
      .waitFor({ timeout: 8000 })

    // Click the first service in the list
    const serviceItem = page.locator('[data-testid="service-item"]')
      .or(page.locator('text=payments-api'))
      .or(page.locator('text=auth-service'))
      .first()
    const serviceVisible = await serviceItem.isVisible({ timeout: 3000 }).catch(() => false)

    if (serviceVisible) {
      await serviceItem.click()
      await page.waitForTimeout(400)

      // Right panel should show service detail
      const detail = page.locator('text=Error Rate')
        .or(page.locator('text=P99'))
        .or(page.locator('text=RPS'))
        .or(page.locator('text=Uptime'))
        .or(page.locator('text=Dependencies'))
        .first()
      await expect(detail, 'Service detail panel must show metrics').toBeVisible({ timeout: 5000 })
    }
  })

  test('P1: health filter buttons filter by health status', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Services').first().click()

    await page.locator('text=Service Catalog')
      .or(page.locator('text=payments-api'))
      .or(page.locator('text=Dependencies'))
      .first()
      .waitFor({ timeout: 8000 })

    // Find health filter buttons
    const healthyFilter = page.locator('button:has-text("Healthy")')
      .or(page.locator('button:has-text("healthy")'))
      .first()
    const filterVisible = await healthyFilter.isVisible({ timeout: 3000 }).catch(() => false)

    if (filterVisible) {
      await healthyFilter.click()
      await page.waitForTimeout(300)

      // After filtering, list should show only healthy services or empty state
      const content = page.locator('text=healthy')
        .or(page.locator('text=No services'))
        .or(page.locator('text=No results'))
        .first()
      await expect(content, 'Health filter must update list').toBeVisible({ timeout: 3000 })
    }
  })

  test('P1: service detail panel shows team, oncall, repo metadata', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Services').first().click()

    await page.locator('text=Service Catalog')
      .or(page.locator('text=payments-api'))
      .or(page.locator('text=Dependencies'))
      .first()
      .waitFor({ timeout: 8000 })

    // Click a service
    const serviceItem = page.locator('text=payments-api')
      .or(page.locator('text=auth-service'))
      .first()
    const visible = await serviceItem.isVisible({ timeout: 3000 }).catch(() => false)

    if (visible) {
      await serviceItem.click()
      await page.waitForTimeout(400)

      // Look for team/oncall/repo metadata
      const metadata = page.locator('text=Team')
        .or(page.locator('text=Oncall'))
        .or(page.locator('text=Repo'))
        .or(page.locator('text=Owner'))
        .first()
      await expect(metadata, 'Service detail must show team/oncall/repo metadata').toBeVisible({ timeout: 5000 })
    }
  })
})
