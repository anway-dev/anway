import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, uniqueId } from './fixtures'

test.describe('Automations — trigger lifecycle', () => {
  let headers: Record<string, string>
  let createdTriggerIds: string[] = []

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test.afterEach(async ({ request }) => {
    for (const id of createdTriggerIds) {
      try {
        await request.delete(`${GATEWAY}/api/automations/triggers/${id}`, { headers })
      } catch {
        // best-effort cleanup
      }
    }
    createdTriggerIds = []
  })

  test('P0: POST trigger → GET list → PATCH disable → GET confirms disabled → DELETE → not in list', async ({ request }) => {
    // Step 1: create trigger
    const createResp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers,
      data: {
        eventType: 'alert_fired',
        condition: { severity: 'critical' },
        actions: [{ type: 'notify_oncall', target: 'oncall' }],
      },
    })
    expect(createResp.status(), 'POST trigger must succeed').toBe(200)
    const createBody = await createResp.json()
    const created = Array.isArray(createBody) ? createBody[0] : createBody
    expect(created.id, 'created trigger must have an id').toBeDefined()
    createdTriggerIds.push(created.id)

    // Step 2: GET list — trigger in list with correct fields
    const listResp = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
    expect(listResp.status()).toBe(200)
    const list = await listResp.json() as Array<{ id: string; eventType: string; enabled: boolean }>
    const found = list.find(t => t.id === created.id)
    expect(found, `trigger ${created.id} must appear in list`).toBeDefined()
    expect(found!.eventType, 'eventType must be alert_fired').toBe('alert_fired')

    // Step 3: PATCH to disable
    const patchResp = await request.patch(`${GATEWAY}/api/automations/triggers/${created.id}`, {
      headers,
      data: { enabled: false },
    })
    expect(patchResp.status(), 'PATCH trigger must succeed').toBe(200)

    // Step 4: GET list — trigger is disabled
    const listAfterPatch = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
    expect(listAfterPatch.status()).toBe(200)
    const listData = await listAfterPatch.json() as Array<{ id: string; enabled: boolean }>
    const disabledTrigger = listData.find(t => t.id === created.id)
    expect(disabledTrigger, 'trigger must still be in list after disable').toBeDefined()
    expect(disabledTrigger!.enabled, 'trigger must be disabled after PATCH').toBe(false)

    // Step 5: DELETE
    const deleteResp = await request.delete(`${GATEWAY}/api/automations/triggers/${created.id}`, { headers })
    expect(deleteResp.status(), 'DELETE trigger must succeed').toBeOneOf([200, 204])
    createdTriggerIds = createdTriggerIds.filter(id => id !== created.id)

    // Step 6: GET list — trigger gone
    const listAfterDelete = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
    expect(listAfterDelete.status()).toBe(200)
    const finalList = await listAfterDelete.json() as Array<{ id: string }>
    expect(
      finalList.some(t => t.id === created.id),
      'deleted trigger must not appear in list'
    ).toBe(false)
  })

  test('P0: POST trigger without eventType returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers,
      data: { actions: [{ type: 'notify_oncall', target: 'oncall' }] },
    })
    expect(resp.status(), 'missing eventType must return 400').toBe(400)
  })

  test('P0: POST trigger with empty actions array returns 400', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers,
      data: { eventType: 'alert_fired', actions: [] },
    })
    expect(resp.status(), 'empty actions array must return 400').toBe(400)
  })

  test('P1: GET monitors returns array (may be empty)', async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/automations/monitors`, { headers })
    expect(resp.status(), 'GET monitors must return 200').toBe(200)
    const body = await resp.json()
    expect(Array.isArray(body), 'monitors response must be an array').toBe(true)
  })

  test('P1: PATCH non-existent trigger returns 404', async ({ request }) => {
    const resp = await request.patch(
      `${GATEWAY}/api/automations/triggers/00000000-0000-0000-0000-000000000099`,
      { headers, data: { enabled: false } }
    )
    expect(resp.status(), 'PATCH non-existent trigger must return 404').toBe(404)
  })

  test('P1: UI — Automations view has Triggers and Monitors tabs', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Automations').first().click()

    // Triggers tab visible
    const triggersTab = page.locator('button:has-text("Triggers")').or(page.locator('text=Triggers').first())
    await expect(triggersTab.first(), 'Triggers tab must be visible').toBeVisible({ timeout: 8000 })

    // Monitors/Cron tab visible
    const monitorsTab = page.locator('button:has-text("Monitors")').or(page.locator('button:has-text("Cron")'))
    await expect(monitorsTab.first(), 'Monitors tab must be visible').toBeVisible({ timeout: 8000 })
  })
})
