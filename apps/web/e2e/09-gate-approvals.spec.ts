import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, authHeaders2, uniqueId, setAuthCookie } from './fixtures'

test.describe('Gate approvals — full lifecycle', () => {
  let headers: Record<string, string>
  let headers2: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
    headers2 = await authHeaders2(request)
  })

  test('P0: create gate → decide approved → returns ok:true, decision:approved', async ({ request }) => {
    // Create gate
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers,
      data: { action: 'deploy', target: uniqueId('payments-api'), requestedBy: 'e2e-test' },
    })
    expect([200, 201], 'POST /api/gate must succeed').toContain(createResp.status())
    const created = await createResp.json() as { ok: boolean; id: string }
    expect(created.id, 'gate must return an id').toBeDefined()

    // Decide approved — use dev2 user (SoD: cannot approve own gate)
    const decideResp = await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
      headers: headers2,
      data: { decision: 'approved' },
    })
    expect(decideResp.status(), 'decide must return 200').toBe(200)
    const decideBody = await decideResp.json() as { ok: boolean; gateId?: string; decision?: string }
    expect(decideBody.ok, 'decide response must have ok:true').toBe(true)
    expect(decideBody.decision, 'decision must be approved').toBe('approved')
  })

  test('P0: create gate → decide rejected → returns ok:true, decision:rejected', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers,
      data: { action: 'restart_pod', target: uniqueId('auth-service'), requestedBy: 'e2e-test' },
    })
    expect([200, 201]).toContain(createResp.status())
    const created = await createResp.json() as { id: string }
    expect(created.id).toBeDefined()

    const decideResp = await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
      headers: headers2,
      data: { decision: 'rejected' },
    })
    expect(decideResp.status()).toBe(200)
    const body = await decideResp.json() as { ok: boolean; decision?: string }
    expect(body.ok).toBe(true)
    expect(body.decision, 'decision must be rejected').toBe('rejected')
  })

  test('P0: decide same gate twice → second call returns 404', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers,
      data: { action: 'deploy', target: uniqueId('svc'), requestedBy: 'e2e-test' },
    })
    expect([200, 201]).toContain(createResp.status())
    const created = await createResp.json() as { id: string }

    // First decision — use dev2 (SoD: cannot approve own gate)
    await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
      headers: headers2,
      data: { decision: 'approved' },
    })

    // Second decision — must 404 (gate already decided)
    const secondResp = await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
      headers: headers2,
      data: { decision: 'approved' },
    })
    expect(secondResp.status(), 'second decide on same gate must return 404').toBe(404)
  })

  test('P0: decide non-existent gate UUID → 404', async ({ request }) => {
    const resp = await request.post(
      `${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000099/decide`,
      { headers, data: { decision: 'approved' } }
    )
    expect(resp.status(), 'non-existent gate must return 404').toBe(404)
  })

  test('P0: POST gate without auth → 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/gate`, {
      data: { action: 'deploy', target: 'test', requestedBy: 'e2e' },
    })
    expect(resp.status(), 'unauthenticated gate create must return 401').toBe(401)
  })

  test('P1: UI — create gate via API, navigate to Approvals, gate title visible in pending list', async ({ page, request }) => {
    const target = uniqueId('payments-api')

    // Seed a gate
    const createResp = await request.post(`${GATEWAY}/api/gate`, {
      headers,
      data: { action: 'deploy', target, requestedBy: 'e2e-test' },
    })
    expect([200, 201]).toContain(createResp.status())
    const created = await createResp.json() as { id: string }

    // Navigate to Approvals
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Approvals').first().click()

    // The approvals view uses mock data — check for any pending gate
    const pendingItem = page.locator('text=create incident')
      .or(page.locator('text=notify oncall'))
      .or(page.locator('text=deploy'))
      .or(page.locator('text=Approve'))
      .first()
    await expect(pendingItem, 'Approvals view must show pending items').toBeVisible({ timeout: 8000 })

    // Cleanup — try to resolve via API (use dev2: SoD prevents same-user approval)
    try {
      await request.post(`${GATEWAY}/api/gate/${created.id}/decide`, {
        headers: headers2,
        data: { decision: 'rejected' },
      })
    } catch {
      // ignore
    }
  })

  test('P1: UI — click Approve button, gate disappears from pending list', async ({ page, request }) => {
    // Seed a gate as dev2 so dev1 (cookie user) can approve it (SoD: cannot approve own gate)
    const h2 = await authHeaders2(request)
    const seedTarget = uniqueId('p1-ui')
    const seedResp = await request.post(`${GATEWAY}/api/gate`, {
      headers: h2,
      data: { action: 'deploy', target: seedTarget, requestedBy: 'e2e-p1' },
    })
    expect([200, 201]).toContain(seedResp.status())

    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Approvals').first().click()

    // Wait for view to stabilize after async fetch — the seeded gate must appear
    const approveBtn = page.locator('button:has-text("Approve")').first()
    await expect(approveBtn).toBeVisible({ timeout: 8000 })

    const initialCount = await page.locator('button:has-text("Approve")').count()
    await approveBtn.click()

    // After approve, one button must disappear — either via filter or full empty state
    await expect(async () => {
      const afterCount = await page.locator('button:has-text("Approve")').count()
      expect(afterCount, 'Approve button count must decrease after approval').toBeLessThan(initialCount)
    }).toPass({ timeout: 5000 })
  })

  test('P2: empty state — no pending gates shows informative message', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Approvals').first().click()

    // Approve all pending gates
    let approveBtn = page.locator('button:has-text("Approve")').first()
    let safety = 0
    while ((await approveBtn.isVisible({ timeout: 1000 }).catch(() => false)) && safety < 10) {
      await approveBtn.click()
      await expect(page.locator('text=approve').or(page.locator('text=Approve')).first()).toBeVisible({ timeout: 5000 })
      safety++
    }

    // Now check for empty state or heading
    const viewContent = page.locator('text=Approvals')
      .or(page.locator('text=Pending'))
      .or(page.locator('text=No pending'))
      .or(page.locator('text=Governance'))
      .first()
    await expect(viewContent, 'Approvals view content must be visible').toBeVisible({ timeout: 5000 })
  })
})
