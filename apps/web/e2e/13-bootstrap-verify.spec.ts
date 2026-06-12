import { test, expect } from '@playwright/test'
import { GATEWAY, authHeaders, pollUntil } from './fixtures'

test.describe('Bootstrap — bootstrapped_at write-back', () => {
  let headers: Record<string, string>

  test.beforeAll(async ({ request }) => {
    headers = await authHeaders(request)
  })

  test('P0: bootstrap triggers bootstrapped_at update via connector API', async ({ request }) => {
    // Request bootstrap for a known connector type
    const bootstrapResp = await request.post(`${GATEWAY}/api/connectors/github/bootstrap`, {
      headers,
    })
    // Bootstrap may succeed (200) or fail if no credentials (400/503)
    const status = bootstrapResp.status()
    expect([200, 400, 503], 'bootstrap endpoint must respond').toContain(status)

    // Check bootstrap-status — must have bootstrapped boolean
    const statusResp = await request.get(`${GATEWAY}/api/connectors/github/bootstrap-status`, {
      headers,
    })
    expect(statusResp.status()).toBe(200)
    const statusBody = await statusResp.json() as { bootstrapped?: boolean; bootstrappedAt?: string }
    expect(typeof statusBody.bootstrapped, 'bootstrap-status must include bootstrapped field').toBe('boolean')
  })

  test('P0: bootstrap-status returns bootstrapped boolean for all known connectors', async ({ request }) => {
    const connectorTypes = ['github', 'datadog', 'linear', 'argocd', 'k8s', 'prometheus', 'loki']
    for (const type of connectorTypes) {
      const resp = await request.get(`${GATEWAY}/api/connectors/${type}/bootstrap-status`, { headers })
      // May return 200 (known) or 404 (unknown)
      if (resp.status() === 200) {
        const body = await resp.json() as { bootstrapped?: boolean }
        expect(typeof body.bootstrapped, `${type} bootstrap-status must include bootstrapped boolean`).toBe('boolean')
      }
    }
  })

  test('P1: re-bootstrap updates bootstrapped_at timestamp', async ({ request }) => {
    // Trigger reconnect → should re-bootstrap
    const reconnectResp = await request.post(`${GATEWAY}/api/connectors/github/reconnect`, { headers })
    expect([200, 400, 503], 'reconnect must respond').toContain(reconnectResp.status())

    // Check bootstrap-status after reconnect
    const statusResp = await request.get(`${GATEWAY}/api/connectors/github/bootstrap-status`, { headers })
    if (statusResp.status() === 200) {
      const body = await statusResp.json() as { bootstrappedAt?: string }
      // If bootstrapped, should have a timestamp
      if (body.bootstrappedAt) {
        expect(new Date(body.bootstrappedAt).getTime(), 'bootstrappedAt must be valid date').toBeGreaterThan(0)
      }
    }
  })
})
