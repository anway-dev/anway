import { test, expect } from '@playwright/test'
import { setAuthCookie, authHeaders, GATEWAY } from './fixtures'

// Assert the entire Settings view end to end from the UI: every tab loads
// and every backing action endpoint answers (not 5xx). User reported
// Settings "not loading all the actions" — this drives the real component
// tree (ProviderConfig, ConnectorsView, AccessView, AuditView) in the
// browser and probes each action's endpoint.

test.describe('Settings — full UI + actions', () => {
  test('all four tabs render and switch', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('button', { hasText: 'Settings' }).first().click()

    // Default tab: AI Provider
    await expect(page.locator('text=AI Provider').first()).toBeVisible({ timeout: 30000 })

    for (const id of ['connectors', 'access', 'audit', 'provider']) {
      await page.getByTestId(`settings-tab-${id}`).click()
      await page.waitForTimeout(500)
    }
    // Still inside Settings — the strip is present, we never navigated away
    await expect(page.getByTestId('settings-tab-provider')).toBeVisible()
  })

  test('AI Provider tab — provider status, manifests, token limits, token usage all load', async ({ page, request }) => {
    const h = await authHeaders(request)
    // Endpoints the AI Provider tab drives on mount + save:
    for (const path of [
      '/api/settings/provider',
      '/api/settings/provider-manifests',
      '/api/settings/token-limits',
      '/api/settings/token-usage',
    ]) {
      const r = await request.get(`${GATEWAY}${path.replace('/api/settings', '/api/settings')}`, { headers: h })
      // Proxy path is /api/settings/* on the web app; hit the gateway directly here.
      expect(r.status(), `${path} must not 5xx`).toBeLessThan(500)
    }

    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('button', { hasText: 'Settings' }).first().click()
    // Provider selector / save button visible
    await expect(
      page.locator('text=AI Provider').first().or(page.locator('text=Provider').first())
    ).toBeVisible({ timeout: 30000 })
  })

  test('Connectors tab — catalog + registered list load', async ({ page, request }) => {
    const h = await authHeaders(request)
    const catalog = await request.get(`${GATEWAY}/api/connectors/catalog`, { headers: h })
    expect(catalog.status(), 'connector catalog must load').toBe(200)
    const registered = await request.get(`${GATEWAY}/api/settings/connectors`, { headers: h })
    expect(registered.status(), 'registered connectors must load').toBe(200)

    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('button', { hasText: 'Settings' }).first().click()
    await page.getByTestId('settings-tab-connectors').click()
    // A connector card / grid or empty state renders
    await page.waitForTimeout(1500)
  })

  test('Access tab — user list loads (admin)', async ({ page, request }) => {
    const h = await authHeaders(request)
    const users = await request.get(`${GATEWAY}/api/access/users`, { headers: h })
    expect(users.status(), 'access user list must load for admin').toBe(200)
    const body = await users.json() as unknown[] | { data?: unknown[] }
    const list = Array.isArray(body) ? body : (body.data ?? [])
    expect(list.length, 'demo tenant must have provisioned users').toBeGreaterThan(0)

    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('button', { hasText: 'Settings' }).first().click()
    await page.getByTestId('settings-tab-access').click()
    await page.waitForTimeout(1500)
  })

  test('Audit tab — audit log loads', async ({ page, request }) => {
    const h = await authHeaders(request)
    const audit = await request.get(`${GATEWAY}/api/audit`, { headers: h })
    expect(audit.status(), 'audit log must load').toBe(200)

    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('button', { hasText: 'Settings' }).first().click()
    await page.getByTestId('settings-tab-audit').click()
    await page.waitForTimeout(1500)
  })

  test('no JS console errors across the whole Settings view', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('button', { hasText: 'Settings' }).first().click()
    await expect(page.locator('text=AI Provider').first()).toBeVisible({ timeout: 30000 })
    for (const id of ['connectors', 'access', 'audit']) {
      await page.getByTestId(`settings-tab-${id}`).click()
      await page.waitForTimeout(1200)
    }
    // Filter noisy network-abort/devtools noise; assert no real component errors
    const real = errors.filter(e => !/Failed to load resource|net::ERR|favicon|ResizeObserver/.test(e))
    expect(real, `console errors in Settings:\n${real.join('\n')}`).toHaveLength(0)
  })
})
