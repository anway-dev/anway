
import { test, expect } from "@playwright/test"
import { GATEWAY, authHeaders } from "./fixtures"

test.describe("P0: Automations", () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  test("P0-6.1: Create trigger rule", async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/automations/triggers`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: { eventType: "alert_fired", condition: {}, actions: [{ type: "notify_oncall", target: "oncall" }] },
    })
    expect(resp.status()).toBe(200)
  })

  test("P0-6.2: List monitors", async ({ request }) => {
    const resp = await request.get(`${GATEWAY}/api/automations/monitors`, { headers })
    expect(resp.status()).toBe(200)
    const body = await resp.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})
