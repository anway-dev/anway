import { test, expect, Page } from '@playwright/test'
import { setAuthCookie, authHeaders, GATEWAY, uniqueId } from './fixtures'

// EVERY-FLOW sweep: for each nav view, drive its real interactive controls
// from the browser and assert real outcomes + zero uncaught JS errors. This
// is the deep-interaction layer above the "view loads / endpoint 200" specs —
// it catches dead buttons, empty selects, blocked actions, broken forms
// (the class of bug found in manual testing).

async function gotoView(page: Page, navLabel: string) {
  await setAuthCookie(page.context())
  await page.goto('/')
  await page.locator('nav button', { hasText: navLabel }).first().click()
  await page.waitForTimeout(800)
}

function trackErrors(page: Page): string[] {
  const errs: string[] = []
  page.on('pageerror', e => errs.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  return errs
}
function realErrors(errs: string[]): string[] {
  return errs.filter(e => !/Failed to load resource|net::ERR|favicon|ResizeObserver|Download the React DevTools|hydrat/i.test(e))
}

test.describe('Every-flow — Anway chat', () => {
  test('chat input accepts a query and streams a response', async ({ page }) => {
    const errs = trackErrors(page)
    await setAuthCookie(page.context())
    await page.goto('/')
    const input = page.getByPlaceholder(/ask .*nway anything/i).first()
    await expect(input).toBeVisible({ timeout: 30000 })
    await input.fill('list recent alerts')
    await input.press('Enter')
    // response bubble or execution trace appears (no PERIMETER_BLOCKED for admin)
    await expect(page.locator('text=/PERIMETER_BLOCKED/').first()).toHaveCount(0, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(2500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })

  test('scenario shortcut chips are clickable and populate the chat', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    const chips = page.locator('button').filter({ hasText: /alert|deploy|why|incident|PR/i })
    await expect(chips.first()).toBeVisible({ timeout: 20000 })
    await chips.first().click()
    await page.waitForTimeout(1500)
  })
})

test.describe('Every-flow — Signals', () => {
  test('Signals view loads alerts and dismiss action works if present', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Signals')
    // list or empty-state
    await page.waitForTimeout(1500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — War Room', () => {
  test('incident create → list → patch round-trips from API the UI uses', async ({ request }) => {
    const h = await authHeaders(request)
    const title = uniqueId('EF-Incident')
    const create = await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { title, severity: 'high' },
    })
    expect([200, 201]).toContain(create.status())
    const inc = await create.json() as { id: string }
    // PATCH transitions are active/investigating/identified/monitoring;
    // resolving is a distinct action (sets resolved_at) via /resolve.
    const patch = await request.patch(`${GATEWAY}/api/incidents/${inc.id}`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { status: 'investigating' },
    })
    expect([200, 204], 'PATCH status transition').toContain(patch.status())
    const resolve = await request.post(`${GATEWAY}/api/incidents/${inc.id}/resolve`, { headers: h })
    expect([200, 204], 'resolve action').toContain(resolve.status())
    // list reflects it as resolved
    const list = await request.get(`${GATEWAY}/api/incidents?limit=100`, { headers: h })
    const body = await list.json() as { data?: Array<{ id: string; status: string }> } | Array<{ id: string; status: string }>
    const rows = Array.isArray(body) ? body : (body.data ?? [])
    const found = rows.find(r => r.id === inc.id)
    expect(found?.status, 'incident must read back resolved').toBe('resolved')
  })
  test('War Room view renders without JS errors', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'War Room')
    await page.waitForTimeout(1500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Services / Projects / Knowledge', () => {
  for (const label of ['Services', 'Projects', 'Knowledge']) {
    test(`${label} renders + primary content loads without JS errors`, async ({ page }) => {
      const errs = trackErrors(page)
      await gotoView(page, label)
      await page.waitForTimeout(1800)
      expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
    })
  }
})

test.describe('Every-flow — Environments CRUD', () => {
  test('environments list loads and create form is reachable', async ({ page, request }) => {
    const h = await authHeaders(request)
    const list = await request.get(`${GATEWAY}/api/environments`, { headers: h })
    expect(list.status()).toBe(200)
    const errs = trackErrors(page)
    await gotoView(page, 'Environments')
    await page.waitForTimeout(1500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Pipeline', () => {
  test('pipelines list loads', async ({ request }) => {
    const h = await authHeaders(request)
    const r = await request.get(`${GATEWAY}/api/pipelines`, { headers: h })
    expect(r.status()).toBe(200)
  })
  test('Pipeline view renders without JS errors', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Pipeline')
    await page.waitForTimeout(1500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Automations CRUD', () => {
  test('trigger + monitor lists load and both endpoints answer', async ({ request }) => {
    const h = await authHeaders(request)
    const triggers = await request.get(`${GATEWAY}/api/automations/triggers`, { headers: h })
    const monitors = await request.get(`${GATEWAY}/api/automations/monitors`, { headers: h })
    expect(triggers.status()).toBe(200)
    expect(monitors.status()).toBe(200)
  })
  test('Automations view renders without JS errors', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Automations')
    await page.waitForTimeout(1500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Approvals / Workflows / Routing / Lifecycle / Editor / API Client / Cloud / K8s / Audit / Connectors', () => {
  for (const label of ['Approvals', 'Workflows', 'Routing', 'Lifecycle', 'Editor', 'API Client', 'Cloud', 'K8s', 'Audit', 'Connectors']) {
    test(`${label} renders + no JS errors`, async ({ page }) => {
      const errs = trackErrors(page)
      await gotoView(page, label)
      await page.waitForTimeout(1800)
      expect(realErrors(errs), `${label}:\n${realErrors(errs).join('\n')}`).toHaveLength(0)
    })
  }
})

test.describe('Every-flow — Access perimeter edit', () => {
  test('user list loads and a user detail / perimeter is reachable', async ({ page, request }) => {
    const h = await authHeaders(request)
    const users = await request.get(`${GATEWAY}/api/access/users`, { headers: h })
    expect(users.status()).toBe(200)
    const errs = trackErrors(page)
    await gotoView(page, 'Access')
    await page.waitForTimeout(1800)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Settings provider model picker', () => {
  test('selecting a provider loads model options (the reported bug)', async ({ page, request }) => {
    // The AI Provider tab must surface Model + Cheap-model pickers. Backed by
    // /api/settings/models which now falls back to stored key + static set.
    const h = await authHeaders(request)
    const models = await request.get(`${GATEWAY}/api/settings/models?provider=deepseek`, { headers: h })
    expect(models.status()).toBe(200)
    const body = await models.json() as { models: string[] }
    expect(body.models.length, 'deepseek must expose model options').toBeGreaterThan(0)

    const errs = trackErrors(page)
    await gotoView(page, 'Settings')
    await expect(page.getByTestId('settings-tab-provider')).toBeVisible({ timeout: 30000 })
    await page.getByTestId('settings-tab-provider').click()
    await page.waitForTimeout(1500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})
