/**
 * Slack command endpoint security.
 * Verifies fail-closed behavior: without SLACK_SIGNING_SECRET configured,
 * the endpoint rejects all requests (503). With signing secret configured,
 * requests without valid Slack signature headers get 401.
 */
import { test, expect } from '@playwright/test'
import { GATEWAY } from './fixtures'

test.describe('Slack commands — security', () => {
  test('POST /api/slack/commands without signing headers returns 401 or 503', async ({ request }) => {
    // 503 = SLACK_SIGNING_SECRET not configured (fail-closed)
    // 401 = signing secret configured but no signature headers
    const resp = await request.post(`${GATEWAY}/api/slack/commands`, {
      data: { command: '/anvay', text: 'approve gate-123' },
    })
    expect([401, 503]).toContain(resp.status())
  })

  test('POST /api/slack/commands with expired timestamp returns 401 or 503', async ({ request }) => {
    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 400) // 400s ago > 5min replay window
    const resp = await request.post(`${GATEWAY}/api/slack/commands`, {
      headers: {
        'x-slack-request-timestamp': expiredTimestamp,
        'x-slack-signature': 'v0=invalidsignature',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: 'command=%2Fanvay&text=approve+gate-123',
    })
    // 503 = no signing secret; 401 = expired or invalid signature
    expect([401, 503]).toContain(resp.status())
  })

  test('POST /api/slack/commands with invalid signature returns 401 or 503', async ({ request }) => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const resp = await request.post(`${GATEWAY}/api/slack/commands`, {
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=0000000000000000000000000000000000000000000000000000000000000000',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: 'command=%2Fanvay&text=approve+gate-123',
    })
    expect([401, 503]).toContain(resp.status())
  })

  test('POST /api/slack/commands is NOT accessible with JWT auth (Slack uses HMAC, not JWT)', async ({ request }) => {
    // This endpoint must NOT accept JWT tokens — it uses Slack HMAC signing
    // Sending a JWT in Authorization should not bypass Slack signature check
    const tokenResp = await request.get(`${GATEWAY}/api/auth/dev-token`)
    const token = (await tokenResp.json() as { token: string }).token
    const resp = await request.post(`${GATEWAY}/api/slack/commands`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { command: '/anvay', text: 'approve gate-123' },
    })
    // Must NOT be 200 — JWT should not bypass Slack signature
    expect(resp.status()).not.toBe(200)
  })
})
