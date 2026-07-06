import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildApp } from '../../app.js'
import { initMetrics } from '../../metrics.js'

process.env['JWT_SECRET'] = 'test-secret'
process.env['GITHUB_WEBHOOK_SECRET'] = 'test-gh-secret'
process.env['ANWAY_WEBHOOK_TENANT'] = '00000000-0000-0000-0000-000000000001'
delete process.env['ANWAY_WEBHOOK_TOKEN']

let app: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  initMetrics()
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

// Regression coverage for a real bug: verifyWebhookSignatures used to return
// a plain boolean, so a genuinely *valid* signature and "no secret
// configured" both collapsed to the same `true`, and authenticateEvent
// always fell through to app.authenticate() (JWT) afterward. A real
// GitHub/Datadog webhook sender never carries a JWT, so a correctly-signed
// webhook could reject a forgery but could never itself succeed — HMAC auth
// was dead code that only ever gated rejection, never let a legitimate
// signed request in.
describe('webhook HMAC authentication', () => {
  const payload = JSON.stringify({ service: 'payments-api', sha: 'abc123' })

  it('authenticates and processes a request with a valid HMAC signature (no JWT)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/events/deploy',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(payload, 'test-gh-secret'),
      },
      payload,
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true })
  })

  it('rejects a request with an invalid HMAC signature', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/events/deploy',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=' + '0'.repeat(64),
      },
      payload,
    })
    expect(r.statusCode).toBe(401)
  })

  it('falls through to JWT auth when no signature header is present', async () => {
    // Secret is configured but this request carries no signature header at
    // all — treated as a normal authenticated-user request, not a forged
    // webhook, so it should 401 for lacking a JWT rather than for a bad
    // signature.
    const r = await app.inject({
      method: 'POST',
      url: '/api/events/deploy',
      headers: { 'content-type': 'application/json' },
      payload,
    })
    expect(r.statusCode).toBe(401)
  })
})
