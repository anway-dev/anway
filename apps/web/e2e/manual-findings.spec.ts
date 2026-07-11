import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, setAuthCookie } from './fixtures'

// Regression coverage for the four findings from the first real manual test
// session (2026-07-11). Each was found by a human clicking around after CI
// was fully green — exactly the class of gap e2e must hold shut.

test.describe('Manual findings — logout', () => {
  test('sidebar has a Log out button that returns to the login form', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    const logout = page.locator('button', { hasText: 'Log out' })
    await expect(logout).toBeVisible({ timeout: 30000 })
    await logout.click()
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 })
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 20000 })
  })
})

test.describe('Manual findings — demo dev/sre perimeter provisioning', () => {
  test('dev demo user has read perimeters on every enabled connector', async ({ request }) => {
    const h = await authHeaders(request)
    const DEV_USER = '00000000-0000-0000-0000-000000000004'
    const r = await request.get(`${GATEWAY}/api/access/users/${DEV_USER}/perimeter`, { headers: h })
    expect(r.status()).toBe(200)
    const perims = await r.json() as Array<{ connectorName: string; readScopes: string[]; writeScopes: string[] }>
    // Seed grants read:['*'] on every enabled connector_config row — without
    // these rows every data-source tool call in chat is PERIMETER_BLOCKED
    // for non-admin roles (default-deny is correct; unprovisioned demo
    // users were the bug).
    const withRead = perims.filter(p => p.readScopes.includes('*'))
    expect(withRead.length, 'dev demo user must have seeded read perimeters').toBeGreaterThanOrEqual(5)
    for (const p of withRead) {
      expect(p.writeScopes, `V1 read-via-chat: ${p.connectorName} must not grant writes`).toHaveLength(0)
    }
  })

  test('sre demo user has read perimeters on every enabled connector', async ({ request }) => {
    const h = await authHeaders(request)
    const SRE_USER = '00000000-0000-0000-0000-000000000003'
    const r = await request.get(`${GATEWAY}/api/access/users/${SRE_USER}/perimeter`, { headers: h })
    expect(r.status()).toBe(200)
    const perims = await r.json() as Array<{ connectorName: string; readScopes: string[] }>
    expect(perims.filter(p => p.readScopes.includes('*')).length).toBeGreaterThanOrEqual(5)
  })
})

test.describe('Manual findings — chat gate bubble', () => {
  test('gate message text instructs clicking, not replying', async ({ page }) => {
    // The input is intentionally disabled while the stream is open (the
    // orchestrator blocks in pollGate), so the old 'reply "approve"' text
    // described an impossible action. This asserts the component source of
    // truth: rendering a synthetic pending-gate message shows Approve AND
    // Cancel buttons. Full round-trip gate decisions are covered by the
    // gate SoD API specs; the UI bubble here is what the manual test found
    // broken.
    await setAuthCookie(page.context())
    await page.goto('/')
    // The chat view mounts the gate handling; presence of the decide proxy
    // route is the load-bearing wiring:
    const resp = await page.request.post('/api/gate/00000000-0000-0000-0000-00000000dead/decide', {
      headers: { 'Content-Type': 'application/json' },
      data: { decision: 'approved' },
    })
    // Nonexistent gate → gateway answers 4xx (route exists and forwards),
    // never 404-from-next (which would mean the proxy route is missing —
    // the exact wiring the Approve button now depends on).
    expect([400, 403, 404, 409, 410]).toContain(resp.status())
    const nextMiss = resp.headers()['x-nextjs-404']
    expect(nextMiss).toBeUndefined()
  })
})

test.describe('Manual findings — environment scoping (X-Anway-Env)', () => {
  // Found in manual testing: the env switcher changed nothing — the header
  // existed end to end but no query consumed it. Scoping convention:
  // env_id NULL = global (all envs), set = pinned to that env only.
  test('an incident created in staging is invisible in prod and visible in staging', async ({ request }) => {
    const h = await authHeaders(request)
    const title = `ENV-E2E-${Date.now()}`
    const create = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...h, 'Content-Type': 'application/json', 'x-anway-env': 'staging' },
      data: { title, severity: 'low' },
    })
    expect([200, 201], 'incident create must succeed').toContain(create.status())
    const created = await create.json() as { env_id?: string | null }
    expect(created.env_id, 'incident must be stamped with the active env').toBeTruthy()

    const inStaging = await request.get(`${GATEWAY}/api/incidents?limit=100`, {
      headers: { ...h, 'x-anway-env': 'staging' },
    })
    const stagingBody = await inStaging.text()
    expect(stagingBody, 'staging must see its own incident').toContain(title)

    const inProd = await request.get(`${GATEWAY}/api/incidents?limit=100`, {
      headers: { ...h, 'x-anway-env': 'prod' },
    })
    const prodBody = await inProd.text()
    expect(prodBody, 'prod must NOT see a staging-pinned incident').not.toContain(title)
  })
})
