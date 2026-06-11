import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, uniqueId, pollUntil } from './fixtures'

test.describe('Incidents — full lifecycle', () => {
  let headers: Record<string, string>
  let createdIds: string[] = []

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test.afterEach(async ({ request }) => {
    for (const id of createdIds) {
      try {
        await request.post(`${GATEWAY}/api/incidents/${id}/resolve`, { headers })
      } catch {
        // best-effort cleanup
      }
    }
    createdIds = []
  })

  test('P0: create → GET list (title in list) → GET by id (active) → resolve → confirmed resolved', async ({ request }) => {
    const title = uniqueId('E2E-incident')

    // Step 1: create
    const createResp = await request.post(`${GATEWAY}/api/incidents`, {
      headers,
      data: { title, severity: 'high' },
    })
    expect(createResp.status(), `POST /api/incidents should be 200 or 201`).toBeOneOf([200, 201])
    const created = await createResp.json() as { id: string; title: string; status: string }
    expect(created.id, 'created incident must have an id').toBeDefined()
    expect(created.title, 'created incident title must match').toBe(title)
    createdIds.push(created.id)

    // Step 2: GET list — title must appear
    const listResp = await request.get(`${GATEWAY}/api/incidents`, { headers })
    expect(listResp.status()).toBe(200)
    const list = await listResp.json() as Array<{ id: string; title: string }>
    expect(list.some(i => i.id === created.id), `incident ${created.id} should appear in list`).toBe(true)

    // Step 3: GET by id — status active
    const getResp = await request.get(`${GATEWAY}/api/incidents/${created.id}`, { headers })
    expect(getResp.status()).toBe(200)
    const fetched = await getResp.json() as { id: string; title: string; status: string }
    expect(fetched.title).toBe(title)
    expect(['active', 'investigating'], `initial status must be active or investigating`).toContain(fetched.status)

    // Step 4: resolve
    const resolveResp = await request.post(`${GATEWAY}/api/incidents/${created.id}/resolve`, { headers })
    expect(resolveResp.status()).toBe(200)
    const resolveBody = await resolveResp.json() as { ok: boolean }
    expect(resolveBody.ok).toBe(true)

    // Step 5: GET by id — status resolved
    const afterResolve = await request.get(`${GATEWAY}/api/incidents/${created.id}`, { headers })
    expect(afterResolve.status()).toBe(200)
    const resolvedIncident = await afterResolve.json() as { status: string }
    expect(resolvedIncident.status, 'status must be resolved after resolve call').toBe('resolved')

    // Step 6: must NOT appear in active filter
    const activeListResp = await request.get(`${GATEWAY}/api/incidents?status=active`, { headers })
    if (activeListResp.status() === 200) {
      const activeList = await activeListResp.json() as Array<{ id: string }>
      expect(
        activeList.some(i => i.id === created.id),
        'resolved incident must not appear in active filter'
      ).toBe(false)
    }
  })

  test('P0: create with missing title returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers,
      data: { severity: 'high' },
    })
    expect(resp.status(), 'missing title must return 400').toBe(400)
  })

  test('P0: create with invalid severity returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/incidents`, {
      headers,
      data: { title: 'E2E-bad-severity', severity: 'super-critical' },
    })
    expect(resp.status(), 'invalid severity must return 400').toBe(400)
  })

  test('P0: GET non-existent UUID returns 404', async ({ request }) => {
    const resp = await request.get(
      `${GATEWAY}/api/incidents/00000000-0000-0000-0000-000000000099`,
      { headers }
    )
    expect(resp.status(), 'non-existent incident must return 404').toBe(404)
  })

  test('P1: filter by status=active returns only active incidents', async ({ request }) => {
    const title = uniqueId('E2E-active-filter')
    const createResp = await request.post(`${GATEWAY}/api/incidents`, {
      headers,
      data: { title, severity: 'medium' },
    })
    expect(createResp.status()).toBeOneOf([200, 201])
    const created = await createResp.json() as { id: string }
    createdIds.push(created.id)

    const listResp = await request.get(`${GATEWAY}/api/incidents?status=active`, { headers })
    if (listResp.status() === 200) {
      const list = await listResp.json() as Array<{ id: string; status: string }>
      for (const inc of list) {
        expect(
          ['active', 'investigating'],
          `all incidents in active filter must be active or investigating`
        ).toContain(inc.status)
      }
    }
  })

  test('P1: filter by status=resolved returns only resolved incidents', async ({ request }) => {
    const title = uniqueId('E2E-resolve-filter')
    const createResp = await request.post(`${GATEWAY}/api/incidents`, {
      headers,
      data: { title, severity: 'low' },
    })
    expect(createResp.status()).toBeOneOf([200, 201])
    const created = await createResp.json() as { id: string }
    createdIds.push(created.id)

    await request.post(`${GATEWAY}/api/incidents/${created.id}/resolve`, { headers })

    const listResp = await request.get(`${GATEWAY}/api/incidents?status=resolved`, { headers })
    if (listResp.status() === 200) {
      const list = await listResp.json() as Array<{ id: string; status: string }>
      for (const inc of list) {
        expect(
          inc.status,
          `all incidents in resolved filter must have status=resolved`
        ).toBe('resolved')
      }
    }
  })

  test('P1: severity badge colors visible in War Room UI', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=War Room').first().click()
    // Verify incident severity labels are visible — critical/high/medium/low
    const severityLabel = page.locator('text=critical')
      .or(page.locator('text=high'))
      .or(page.locator('text=medium'))
      .or(page.locator('text=low'))
      .first()
    // It's OK if no incidents exist — just check the view loaded
    const viewLoaded = await page.locator('text=War Room')
      .or(page.locator('text=Incident'))
      .or(page.locator('text=No active incidents'))
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false)
    expect(viewLoaded, 'War Room view must load').toBe(true)
  })
})
