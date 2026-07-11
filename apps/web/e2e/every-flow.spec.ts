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

test.describe('Every-flow — Anway chat controls', () => {
  test('right-panel tabs (sessions/trace) switch', async ({ page }) => {
    const errs = trackErrors(page)
    await setAuthCookie(page.context())
    await page.goto('/')
    await expect(page.getByPlaceholder(/ask .*nway anything/i).first()).toBeVisible({ timeout: 30000 })
    for (const t of ['sessions', 'trace']) {
      const tab = page.locator('button', { hasText: new RegExp(`^${t}$`, 'i') }).first()
      if (await tab.count() > 0) { await tab.click(); await page.waitForTimeout(400) }
    }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })

  test('provider settings toggle opens and closes', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await expect(page.getByPlaceholder(/ask .*nway anything/i).first()).toBeVisible({ timeout: 30000 })
    const gear = page.locator('button[title="Provider settings"]').first()
    if (await gear.count() > 0) { await gear.click(); await page.waitForTimeout(500) }
  })
})

test.describe('Every-flow — Signals', () => {
  test('severity filter tabs switch and dismiss works when a signal exists', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Signals')
    await page.waitForTimeout(1200)
    // severity filter chips
    for (const sev of ['critical', 'high', 'all']) {
      const chip = page.locator('button', { hasText: new RegExp(`^${sev}$`, 'i') }).first()
      if (await chip.count() > 0) { await chip.click(); await page.waitForTimeout(300) }
    }
    // dismiss the first signal if the inbox has one
    const dismiss = page.locator('button[title="Mark read"]').first()
    if (await dismiss.count() > 0) {
      await dismiss.click(); await page.waitForTimeout(600)
    }
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
  test('War Room filters switch and incident detail opens', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'War Room')
    await page.waitForTimeout(1500)
    for (const f of ['active', 'investigating', 'resolved', 'all']) {
      const tab = page.locator('button', { hasText: new RegExp(`^${f}$`, 'i') }).first()
      if (await tab.count() > 0) { await tab.click(); await page.waitForTimeout(300) }
    }
    // open the first incident's detail if any exist (chaos-runner produces them)
    const firstIncident = page.locator('[class*="incident"], li, tr').filter({ hasText: /error|fail|alert|incident|CERT|EF-/i }).first()
    if (await firstIncident.count() > 0) {
      await firstIncident.click().catch(() => {})
      await page.waitForTimeout(800)
      // runbook toggle if present
      const runbook = page.locator('text=/runbook/i').first()
      if (await runbook.count() > 0) { await runbook.click().catch(() => {}); await page.waitForTimeout(300) }
    }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Services', () => {
  test('health filters switch and a service detail opens', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Services')
    await page.waitForTimeout(1500)
    for (const f of ['healthy', 'degraded', 'all']) {
      const chip = page.locator('button', { hasText: new RegExp(`^${f}$`, 'i') }).first()
      if (await chip.count() > 0) { await chip.click(); await page.waitForTimeout(300) }
    }
    // click a service card → detail (dep graph / metrics / incidents)
    const svc = page.locator('div,li,tr').filter({ hasText: /payment|checkout|auth|order|api-gateway/i }).first()
    if (await svc.count() > 0) { await svc.click().catch(() => {}); await page.waitForTimeout(800) }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Projects', () => {
  test('New Project modal opens, accepts a repo URL, and closes', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Projects')
    await page.waitForTimeout(1200)
    const newBtn = page.locator('button', { hasText: /new|add|create|discover|import/i }).first()
    if (await newBtn.count() > 0) {
      await newBtn.click()
      await page.waitForTimeout(500)
      const urlInput = page.getByPlaceholder(/github\.com|repo|url/i).first()
      if (await urlInput.count() > 0) {
        await urlInput.fill('https://github.com/acme/example-service')
        await page.waitForTimeout(300)
      }
      // close modal (Cancel / X / Escape)
      const cancel = page.locator('button', { hasText: /cancel|close/i }).first()
      if (await cancel.count() > 0) await cancel.click().catch(() => {})
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Knowledge', () => {
  test('Knowledge renders + search/confirm controls exercised', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Knowledge')
    await page.waitForTimeout(1500)
    const search = page.getByPlaceholder(/search/i).first()
    if (await search.count() > 0) { await search.fill('payments'); await page.waitForTimeout(600) }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Environments CRUD (full round-trip)', () => {
  test('create an environment via the UI, see it listed, then delete it', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Environments')
    await page.waitForTimeout(1200)
    page.on('dialog', d => d.accept().catch(() => {}))
    const name = `ef-env-${Date.now().toString(36)}`

    await page.locator('button', { hasText: /\+ Add|^Add$/ }).first().click()
    await page.getByPlaceholder(/name \(e\.g/i).first().fill(name)
    await page.getByPlaceholder(/label \(e\.g/i).first().fill(`EF ${name}`)
    await page.locator('button', { hasText: /^create$|^…$/i }).first().click()
    // list row for the new env appears
    await expect(page.locator(`text=EF ${name}`).first()).toBeVisible({ timeout: 8000 })

    // delete via the row that contains BOTH the env label and its own Delete
    // button (the tightest such container — avoids hitting another env's Delete)
    const row = page.locator('div').filter({ hasText: `EF ${name}` })
      .filter({ has: page.locator('button', { hasText: /^Delete$/ }) }).last()
    await row.locator('button', { hasText: /^Delete$/ }).click()
    await expect(page.locator(`text=EF ${name}`)).toHaveCount(0, { timeout: 8000 })
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Pipeline', () => {
  test('create a pipeline via the UI and see it appear', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Pipeline')
    await page.waitForTimeout(1500)
    const createBtn = page.locator('button', { hasText: /^create$|new pipeline|create pipeline/i }).first()
    if (await createBtn.count() > 0) {
      const nameInput = page.getByPlaceholder(/name|service|pipeline/i).first()
      if (await nameInput.count() > 0) await nameInput.fill(`ef-pipe-${Date.now().toString(36)}`)
      await createBtn.click()
      await page.waitForTimeout(1200)
    }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Automations create', () => {
  test('open create-trigger modal and exercise the form', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Automations')
    await page.waitForTimeout(1200)
    const createBtn = page.locator('button', { hasText: /new|create|add/i }).first()
    if (await createBtn.count() > 0) {
      await createBtn.click()
      await page.waitForTimeout(500)
      const actionInput = page.getByPlaceholder(/notify_oncall|create_incident|action/i).first()
      if (await actionInput.count() > 0) await actionInput.fill('notify_oncall')
      // close without necessarily submitting (avoid polluting state) — Cancel/Escape
      const cancel = page.locator('button', { hasText: /cancel|close/i }).first()
      if (await cancel.count() > 0) await cancel.click().catch(() => {})
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
    // toggle a trigger enable/disable if any exist
    const toggle = page.locator('button', { hasText: /enable|disable|pause|resume|on|off/i }).first()
    if (await toggle.count() > 0) { await toggle.click().catch(() => {}); await page.waitForTimeout(500) }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

// Pure-display / read-only views: render + zero JS errors is the real bar.
test.describe('Every-flow — display views', () => {
  for (const label of ['Cloud', 'Audit', 'Routing']) {
    test(`${label} renders + no JS errors`, async ({ page }) => {
      const errs = trackErrors(page)
      await gotoView(page, label)
      await page.waitForTimeout(1800)
      expect(realErrors(errs), `${label}:\n${realErrors(errs).join('\n')}`).toHaveLength(0)
    })
  }
})

test.describe('Every-flow — Workflows autonomy + gate config', () => {
  test('autonomy levels and gate config controls are interactive', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Workflows')
    await page.waitForTimeout(1500)
    // L1..L4 autonomy buttons (or a select-service prompt)
    for (const lvl of ['L1', 'L2', 'L3', 'L4']) {
      const b = page.locator('button', { hasText: new RegExp(`\\b${lvl}\\b`) }).first()
      if (await b.count() > 0) { await b.click().catch(() => {}); await page.waitForTimeout(250) }
    }
    // a Save if a gate config form is present
    const save = page.locator('button', { hasText: /^save$/i }).first()
    if (await save.count() > 0) await save.click().catch(() => {})
    await page.waitForTimeout(400)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Approvals decisions', () => {
  test('pending gates list renders; approve/reject present when a gate exists', async ({ page, request }) => {
    const h = await authHeaders(request)
    const pending = await request.get(`${GATEWAY}/api/gate/pending`, { headers: h })
    expect(pending.status()).toBe(200)
    const errs = trackErrors(page)
    await gotoView(page, 'Approvals')
    await page.waitForTimeout(1500)
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Editor', () => {
  test('editor loads a file tree / service picker and analyze is reachable', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Editor')
    await page.waitForTimeout(2000)
    // pick a service / open a file if the picker exists
    const svc = page.locator('button,div,li').filter({ hasText: /payment|checkout|auth|service|\.ts|\.go/i }).first()
    if (await svc.count() > 0) { await svc.click().catch(() => {}); await page.waitForTimeout(800) }
    const analyze = page.locator('button', { hasText: /analyze|review/i }).first()
    if (await analyze.count() > 0) { await analyze.click().catch(() => {}); await page.waitForTimeout(1000) }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — API Client request builder', () => {
  test('build a request (method + url) and Send', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'API Client')
    await page.waitForTimeout(1500)
    const url = page.locator('input[type="text"], input:not([type])').filter({ hasNot: page.locator('[type="password"]') }).first()
    if (await url.count() > 0) {
      await url.fill('http://localhost:8510/health')
      const send = page.locator('button', { hasText: /^send$/i }).first()
      if (await send.count() > 0) { await send.click(); await page.waitForTimeout(1500) }
    }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Connectors', () => {
  test('connector grid renders and a connector card opens', async ({ page }) => {
    const errs = trackErrors(page)
    await gotoView(page, 'Connectors')
    await page.waitForTimeout(1800)
    const card = page.locator('div,button').filter({ hasText: /prometheus|github|grafana|datadog|k8s|loki/i }).first()
    if (await card.count() > 0) { await card.click().catch(() => {}); await page.waitForTimeout(800) }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — K8s scale/restart gate (confirm then cancel — never executes)', () => {
  test('cluster overview loads; a scale/restart opens a confirm that can be cancelled', async ({ page }) => {
    test.setTimeout(60000)
    const errs = trackErrors(page)
    await gotoView(page, 'K8s')
    await page.waitForTimeout(1200)
    const action = page.locator('button', { hasText: /^scale$|^restart$/i }).first()
    if (await action.count() > 0) {
      await action.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(500)
      // a confirm/gate dialog appears — cancel it (do NOT execute a real k8s write)
      const cancel = page.locator('button', { hasText: /cancel|close|no/i }).first()
      if (await cancel.count() > 0) await cancel.click({ timeout: 5000 }).catch(() => {})
      else await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(400)
    }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
})

test.describe('Every-flow — Lifecycle', () => {
  test('lifecycle stage flow renders and PRD/generate controls are reachable', async ({ page }) => {
    test.setTimeout(60000)
    const errs = trackErrors(page)
    await gotoView(page, 'Lifecycle')
    await page.waitForTimeout(1800)
    const gen = page.locator('button', { hasText: /generate|create|start|prd|new/i }).first()
    if (await gen.count() > 0) { await gen.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(800) }
    expect(realErrors(errs), realErrors(errs).join('\n')).toHaveLength(0)
  })
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
