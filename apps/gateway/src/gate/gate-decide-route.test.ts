import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../app.js'
import { initMetrics } from '../metrics.js'

process.env['JWT_SECRET'] = 'test-secret'

let app: Awaited<ReturnType<typeof buildApp>>

function tokenFor(role: string): string {
  return app.jwt.sign({
    sub: '00000000-0000-0000-0000-000000000002',
    email: 'u@example.com',
    tenantId: '00000000-0000-0000-0000-000000000001',
    role,
  })
}

beforeAll(async () => {
  initMetrics()
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

describe('POST /api/gate', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { action: 'editor.commit', target: '/tmp/x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a role with no editor/write access at all (pm)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      headers: { authorization: `Bearer ${tokenFor('pm')}` },
      payload: { action: 'editor.commit', target: '/tmp/x' },
    })
    expect(res.statusCode).toBe(403)
    // requireRole's access_denied audit write is a real Postgres roundtrip
    // (see gate-policies.test.ts) — exceeds vitest's default 5000ms under
    // `pnpm test`'s full-monorepo parallel load.
  }, 15_000)

  // Regression test: editor.commit requires an approved gate, and
  // editor.commit's own execute route allows admin/dev — but this create
  // route previously required admin/sre, so a dev-role user had no way to
  // ever request the approval their own commit needed. A dev must be able
  // to reach past the role check here (any non-403 status — DB
  // availability in CI is a separate concern from the role gate itself).
  it('lets a dev-role user past the role check to create a gate request', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      headers: { authorization: `Bearer ${tokenFor('dev')}` },
      payload: { action: 'editor.commit', target: '/tmp/x' },
    })
    expect(res.statusCode).not.toBe(403)
    // Real DB roundtrip (gate insert attempt) — same full-parallel-load
    // allowance as this file's other DB-touching tests.
  }, 15_000)

  it('still lets sre and admin past the role check', async () => {
    for (const role of ['sre', 'admin']) {
      const res = await app.inject({
        method: 'POST', url: '/api/gate',
        headers: { authorization: `Bearer ${tokenFor(role)}` },
        payload: { action: 'k8s__restart_deployment', target: 'prod/payments-api' },
      })
      expect(res.statusCode).not.toBe(403)
    }
  }, 15_000)
})

describe('POST /api/gate/:gateId/decide', () => {
  // Approval stays privileged regardless of who can create a request —
  // dev must not be able to approve gates (SoD + role are independent
  // controls; relaxing creation must not relax decision).
  it('rejects a dev-role user from deciding a gate', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/gate/00000000-0000-0000-0000-000000000099/decide',
      headers: { authorization: `Bearer ${tokenFor('dev')}` },
      payload: { decision: 'approved' },
    })
    expect(res.statusCode).toBe(403)
  }, 15_000)
})
