import { test, expect } from '@playwright/test'
import { authHeaders, GATEWAY, uniqueId } from './fixtures'

// OUTCOME assertions. The exhaustive/every-flow specs verify "interacting
// with a control does not throw" — necessary but not sufficient: a control
// can silently no-op (e.g. a Save that returns early) and still "pass". These
// tests assert the RESULT: after a mutation, read it back and prove it
// persisted / took effect. This is the layer that catches the class of bug
// where the UI looks fine but nothing actually happened.

test.describe('Outcome — provider config persists (incl. model-only edit)', () => {
  test('saving provider + model reads back with that exact model', async ({ request }) => {
    const h = await authHeaders(request)
    // full save
    const save1 = await request.post(`${GATEWAY}/api/settings/provider`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { provider: 'deepseek', defaultModel: 'deepseek-chat', cheapModel: 'deepseek-chat' },
    })
    expect(save1.status()).toBe(200)
    const read1 = await (await request.get(`${GATEWAY}/api/settings/provider`, { headers: h })).json() as { provider?: string; defaultModel?: string }
    expect(read1.provider).toBe('deepseek')
    expect(read1.defaultModel, 'saved model must read back').toBe('deepseek-chat')

    // MODEL-ONLY edit (no apiKey in body — the exact case that silently
    // no-op'd in the UI): change just the default model, assert it persists.
    const save2 = await request.post(`${GATEWAY}/api/settings/provider`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { provider: 'deepseek', defaultModel: 'deepseek-reasoner' },
    })
    expect(save2.status()).toBe(200)
    const read2 = await (await request.get(`${GATEWAY}/api/settings/provider`, { headers: h })).json() as { defaultModel?: string }
    expect(read2.defaultModel, 'model-only edit must persist the new model').toBe('deepseek-reasoner')
  })
})

test.describe('Outcome — provider models are fetched, never fabricated', () => {
  test('unresolvable provider returns empty + honest error, not invented names', async ({ request }) => {
    const h = await authHeaders(request)
    // deepseek is dynamic; with no reachable key the endpoint must NOT return
    // a hardcoded model set — it must be empty with an error string.
    const r = await request.get(`${GATEWAY}/api/settings/models?provider=deepseek`, { headers: h })
    expect(r.status()).toBe(200)
    const body = await r.json() as { models: string[]; error?: string }
    // Either the real fetch worked (non-empty, real names) OR it failed
    // honestly (empty + error) — never a fabricated non-empty list without a
    // real fetch. We can't assert which without a live key, but we CAN assert
    // the contract: if empty, there is an error explaining why.
    if (body.models.length === 0) {
      expect(body.error, 'empty models must carry an honest error, not silent []').toBeTruthy()
    }
  })
})

test.describe('Outcome — env switcher reloads and applies the selected env (UI)', () => {
  test('choosing a different env reloads the app and the switcher shows it', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    // The env selector button shows the active env's label (e.g. "Production").
    const selector = page.locator('button', { hasText: /Production|Pre-production/ }).first()
    await expect(selector, 'env selector must render').toBeVisible({ timeout: 20000 })
    const before = (await selector.innerText()).replace(/[▾\s]+$/, '').trim()

    // Mark the current document so we can prove a real reload happened (a reload
    // discards this property; an in-place state update would keep it).
    await page.evaluate(() => { (window as unknown as { __noReload?: boolean }).__noReload = true })

    // Open the dropdown and pick the OTHER environment.
    await selector.click()
    const other = before.includes('Pre-production') ? 'Production' : 'Pre-production'
    await page.locator('button', { hasText: new RegExp(`^\\s*${other}\\s*$`) }).first().click()

    // A genuine page reload must occur (switcher's contract: reload with the
    // new env's data). Wait for the app to come back up post-reload.
    await page.waitForLoadState('load')
    await expect(page.locator('button', { hasText: /Production|Pre-production/ }).first())
      .toBeVisible({ timeout: 20000 })
    const reloaded = await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload !== true)
    expect(reloaded, 'switching env must hard-reload the page (not just swap state)').toBe(true)

    // After reload the switcher must reflect the chosen env, and it must persist.
    const after = (await page.locator('button', { hasText: /Production|Pre-production/ }).first().innerText())
      .replace(/[▾\s]+$/, '').trim()
    expect(after, 'switcher must show the newly selected env after reload').toContain(other)
  })
})

test.describe('Outcome — environment scoping actually segregates', () => {
  test('a preprod-labeled alert incident is visible in preprod and NOT in prod', async ({ request }) => {
    const h = await authHeaders(request)
    const name = uniqueId('OutcomeEnvAlert')
    const fire = await request.post(`${GATEWAY}/api/events/alert`, {
      headers: { 'Authorization': 'Bearer anway-demo-webhook-token', 'Content-Type': 'application/json' },
      data: { version: '4', alerts: [{ status: 'firing', labels: { alertname: name, severity: 'high', service: 'payments-api', environment: 'preprod' } }] },
    })
    expect(fire.status()).toBe(200)

    // poll preprod for the incident (async subscriber)
    let inPreprod = false
    for (let i = 0; i < 15; i++) {
      const r = await request.get(`${GATEWAY}/api/incidents?limit=100`, { headers: { ...h, 'x-anway-env': 'preprod' } })
      if ((await r.text()).includes(name)) { inPreprod = true; break }
      await new Promise(res => setTimeout(res, 1000))
    }
    expect(inPreprod, 'preprod-labeled incident must appear in preprod view').toBe(true)

    const prodText = await (await request.get(`${GATEWAY}/api/incidents?limit=100`, { headers: { ...h, 'x-anway-env': 'prod' } })).text()
    expect(prodText.includes(name), 'preprod-labeled incident must NOT appear in prod view').toBe(false)
  })

  test('an unlabeled alert incident is global — visible in every env', async ({ request }) => {
    const h = await authHeaders(request)
    const name = uniqueId('OutcomeGlobalAlert')
    await request.post(`${GATEWAY}/api/events/alert`, {
      headers: { 'Authorization': 'Bearer anway-demo-webhook-token', 'Content-Type': 'application/json' },
      data: { version: '4', alerts: [{ status: 'firing', labels: { alertname: name, severity: 'high', service: 'payments-api' } }] },
    })
    let seen = false
    for (let i = 0; i < 15; i++) {
      const r = await request.get(`${GATEWAY}/api/incidents?limit=100`, { headers: { ...h, 'x-anway-env': 'prod' } })
      if ((await r.text()).includes(name)) { seen = true; break }
      await new Promise(res => setTimeout(res, 1000))
    }
    expect(seen).toBe(true)
    const preprodText = await (await request.get(`${GATEWAY}/api/incidents?limit=100`, { headers: { ...h, 'x-anway-env': 'preprod' } })).text()
    expect(preprodText.includes(name), 'unlabeled (global) incident must show in every env').toBe(true)
  })
})

test.describe('Outcome — environment CRUD persists', () => {
  test('create → read → delete → read reflects each step', async ({ request }) => {
    const h = await authHeaders(request)
    const name = `oc-env-${Date.now().toString(36)}`
    const create = await request.post(`${GATEWAY}/api/environments`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { name, label: `OC ${name}` },
    })
    expect([200, 201]).toContain(create.status())
    const id = (await create.json() as { id: string }).id

    const listed = await (await request.get(`${GATEWAY}/api/environments`, { headers: h })).json() as Array<{ id: string; name: string }>
    expect(listed.some(e => e.id === id), 'created env must be listed').toBe(true)

    const del = await request.delete(`${GATEWAY}/api/environments/${id}`, { headers: h })
    expect([200, 204]).toContain(del.status())
    const after = await (await request.get(`${GATEWAY}/api/environments`, { headers: h })).json() as Array<{ id: string }>
    expect(after.some(e => e.id === id), 'deleted env must be gone').toBe(false)
  })
})

test.describe('Outcome — incident lifecycle persists', () => {
  test('create → transition → resolve reads back resolved', async ({ request }) => {
    const h = await authHeaders(request)
    const title = uniqueId('OC-Incident')
    const id = (await (await request.post(`${GATEWAY}/api/incidents`, {
      headers: { ...h, 'Content-Type': 'application/json' }, data: { title, severity: 'high' },
    })).json() as { id: string }).id
    await request.patch(`${GATEWAY}/api/incidents/${id}`, { headers: { ...h, 'Content-Type': 'application/json' }, data: { status: 'investigating' } })
    await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers: h })
    const rows = await (await request.get(`${GATEWAY}/api/incidents?limit=100`, { headers: h })).json() as { data?: Array<{ id: string; status: string }> } | Array<{ id: string; status: string }>
    const list = Array.isArray(rows) ? rows : (rows.data ?? [])
    expect(list.find(r => r.id === id)?.status, 'must read back resolved').toBe('resolved')
  })
})

test.describe('Outcome — per-user perimeter edit persists', () => {
  test('setting a user perimeter reads back the exact scopes', async ({ request }) => {
    const h = await authHeaders(request)
    const DEV = '00000000-0000-0000-0000-000000000004'
    const put = await request.put(`${GATEWAY}/api/access/users/${DEV}/perimeter`, {
      headers: { ...h, 'Content-Type': 'application/json' },
      data: { perimeter: [{ connectorName: 'prometheus', readScopes: ['*'], writeScopes: [] }] },
    })
    expect(put.status()).toBe(200)
    const got = await (await request.get(`${GATEWAY}/api/access/users/${DEV}/perimeter`, { headers: h })).json() as Array<{ connectorName: string; readScopes: string[]; writeScopes: string[] }>
    const prom = got.find(p => p.connectorName === 'prometheus')
    expect(prom, 'perimeter must read back').toBeTruthy()
    expect(prom!.readScopes).toContain('*')
    expect(prom!.writeScopes, 'write scopes must persist as set').toHaveLength(0)
  })
})

import { setAuthCookie } from './fixtures'

// Open the AI Provider form deterministically. A configured provider renders a
// summary card with an "Edit" button; an unconfigured one renders the form
// directly. Clicking Edit is a synchronous state toggle, but in the prod build
// the button can be clicked before hydration finishes — so click and then
// confirm the form actually opened (its password key field appears), retrying
// the click once if the summary card is still showing.
async function openProviderForm(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('nav button', { hasText: 'Settings' }).first().click()
  await page.getByTestId('settings-tab-provider').click({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  const keyField = page.locator('input[type="password"]').first()
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await keyField.isVisible({ timeout: 2000 }).catch(() => false)) return
    const edit = page.locator('button', { hasText: /^Edit$/ }).first()
    if (await edit.isVisible({ timeout: 3000 }).catch(() => false)) {
      await edit.click().catch(() => {})
    }
    await page.waitForTimeout(600)
  }
  // Final wait — form must be open for the assertions that follow.
  await expect(keyField, 'provider form (key field) must open').toBeVisible({ timeout: 8000 })
}

test.describe('Outcome — provider model field is always usable (UI)', () => {
  test('DeepSeek selected: a Model input/select is present even when the live list cannot load', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await openProviderForm(page)
    // The provider form must show a Model field (label + a select or text
    // input) so the user is never stuck without a way to set a model —
    // whether or not the live model list could be fetched. Scope to the form.
    await expect(page.getByText('Model', { exact: true }).first(),
      'a Model field must be present for a selected provider').toBeVisible({ timeout: 10000 })
    const modelControl = page.locator('select, input').filter({ hasNot: page.locator('[type="password"]') })
    expect(await modelControl.count(), 'a model select or text input must exist').toBeGreaterThan(0)
  })

  test('an INVALID key produces a visible on-screen error, not a silent empty state', async ({ page }) => {
    // The user's exact complaint: if the provider rejects the key, the screen
    // must SAY so — not just render nothing. Type a syntactically-valid but
    // unauthorized key, then assert the real upstream rejection surfaces as a
    // visible banner (the gateway forwards the provider's own error verbatim).
    await setAuthCookie(page.context())
    await page.goto('/')
    await openProviderForm(page)

    const keyField = page.locator('input[type="password"]').first()
    await expect(keyField, 'API key field must be present to test an invalid key').toBeVisible({ timeout: 10000 })
    await keyField.fill('sk-badbadbadbadbadbadbadbadbadbad00')
    // debounce (600ms) + network round-trip to the provider
    await page.waitForTimeout(2500)

    // The amber banner must appear and must carry the REAL reason (rejected /
    // invalid / verify), not a blank screen.
    await expect(
      page.getByText(/rejected the request|invalid|verify your API key|could not (reach|fetch)/i).first(),
      'an invalid key must surface a visible error banner, never a silent empty state',
    ).toBeVisible({ timeout: 10000 })
  })
})
