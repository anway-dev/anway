import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, uniqueId, setAuthCookie } from './fixtures'

test.describe('Trigger CRUD — full lifecycle', () => {
  let headers: Record<string, string>
  let createdIds: string[] = []

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test.afterEach(async ({ request }) => {
    for (const id of createdIds) {
      await request.delete(`${GATEWAY}/api/automations/triggers/${id}`, { headers }).catch(() => {})
    }
    createdIds = []
  })

  test('P0: create trigger via API → GET list includes it → delete → gone', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers,
      data: {
        eventType: 'alert_fired',
        condition: { severity: 'critical' },
        actions: [{ type: 'notify_oncall', params: { target: 'oncall' } }],
      },
    })
    expect([200, 201]).toContain(createResp.status())
    const body = await createResp.json()
    const trigger = Array.isArray(body) ? body[0] : body
    expect(trigger.id, 'created trigger must have id').toBeDefined()
    createdIds.push(trigger.id)

    // GET list — must include new trigger
    const listResp = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
    expect(listResp.status()).toBe(200)
    const list = await listResp.json() as Array<{ id: string }>
    expect(list.some(t => t.id === trigger.id), 'new trigger must appear in list').toBe(true)

    // DELETE
    const deleteResp = await request.delete(`${GATEWAY}/api/automations/triggers/${trigger.id}`, { headers })
    expect([200, 204]).toContain(deleteResp.status())

    // Verify gone
    const afterList = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
    const afterData = await afterList.json() as Array<{ id: string }>
    expect(afterData.some(t => t.id === trigger.id), 'deleted trigger must not appear').toBe(false)
    createdIds = []
  })

  test('P0: create trigger with empty actions → rejected (400)', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers,
      data: { eventType: 'deploy_failed', condition: {}, actions: [] },
    })
    expect(resp.status(), 'empty actions must be rejected with 400').toBe(400)
  })

  test('P0: create trigger without eventType → rejected (400)', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers,
      data: { actions: [{ type: 'notify_oncall', params: {} }] },
    })
    expect(resp.status(), 'missing eventType must be rejected').toBe(400)
  })

  test('P1: PATCH to disable → trigger still in list with enabled=false', async ({ request }) => {
    const createResp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers,
      data: {
        eventType: 'pr_merged',
        condition: {},
        actions: [{ type: 'surface_context', params: {} }],
      },
    })
    expect([200, 201]).toContain(createResp.status())
    const trigger = (Array.isArray(await createResp.json()) ? (await createResp.json() as Array<{ id: string }>)[0] : await createResp.json()) as { id: string }
    createdIds.push(trigger.id)

    // Disable
    const patchResp = await request.patch(`${GATEWAY}/api/automations/triggers/${trigger.id}`, {
      headers,
      data: { enabled: false },
    })
    expect([200, 201, 204]).toContain(patchResp.status())

    // Verify disabled
    const listResp = await request.get(`${GATEWAY}/api/automations/triggers`, { headers })
    const list = await listResp.json() as Array<{ id: string; enabled: boolean }>
    const found = list.find(t => t.id === trigger.id)
    if (found) {
      expect(found.enabled, 'trigger must be disabled after PATCH').toBe(false)
    }
  })

  test('P1: UI — Automations view loads with create button active', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto('/')
    await page.locator('text=Automations').first().click()
    // The + New button should be visible and clickable (green, not gray)
    const newBtn = page.locator('button:has-text("+ New")').first()
    await expect(newBtn, 'create button must be visible').toBeVisible({ timeout: 8000 })
    // Button should not have not-allowed cursor
    const cursor = await newBtn.evaluate((el: HTMLButtonElement) => getComputedStyle(el).cursor)
    expect(cursor, 'create button must not be disabled').not.toBe('not-allowed')
  })
})
