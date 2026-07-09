import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/client.js', () => ({ prisma: {} }))
const er = vi.fn()
vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
    fn({ $executeRaw: er, $queryRaw: vi.fn() })
  ),
}))
vi.mock('../utils/crypto.js', () => ({
  encryptJson: vi.fn((v: unknown) => `enc(${JSON.stringify(v)})`),
  decryptJson: vi.fn(),
}))
vi.mock('../routes/audit.js', () => ({
  appendAuditEvent: vi.fn(async () => {}),
}))

import { ensureGithubWebhook } from './webhook-registrar.js'
import { appendAuditEvent } from '../routes/audit.js'

beforeEach(() => {
  er.mockReset()
  vi.mocked(appendAuditEvent).mockClear()
  vi.unstubAllGlobals()
  delete process.env['ANWAY_PUBLIC_URL']
})

describe('ensureGithubWebhook', () => {
  it('skips visibly (audited) when ANWAY_PUBLIC_URL is not configured — polling fallback covers', async () => {
    const result = await ensureGithubWebhook('t-1', 'conn-1', { token: 'tok', org: 'acme' })
    expect(result).toEqual({ registered: false, reason: 'no_public_url' })
    expect(appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'connector.webhook_registration_skipped' }))
  })

  it('creates an org hook with a per-connector secret and persists registration state', async () => {
    process.env['ANWAY_PUBLIC_URL'] = 'https://anway.example.com'
    er.mockResolvedValue(1)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return { ok: true, json: async () => [] } // list: no existing hooks
      return { ok: true, json: async () => ({ id: 42 }) } // create
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ensureGithubWebhook('t-1', 'conn-1', { token: 'tok', org: 'acme' })
    expect(result.registered).toBe(true)

    const createCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')!
    const body = JSON.parse((createCall[1] as RequestInit).body as string) as { config: { url: string; secret: string }; events: string[] }
    expect(body.config.url).toBe('https://anway.example.com/api/events/github/conn-1')
    expect(body.config.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(body.events).toContain('pull_request')
    // sync_state persisted (hook id + encrypted secret)
    expect(er).toHaveBeenCalled()
  })

  it('is idempotent — reuses an existing hook already pointing at this receiver instead of duplicating', async () => {
    process.env['ANWAY_PUBLIC_URL'] = 'https://anway.example.com'
    er.mockResolvedValue(1)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: 7, config: { url: 'https://anway.example.com/api/events/github/conn-1' } }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ensureGithubWebhook('t-1', 'conn-1', { token: 'tok', org: 'acme' })
    expect(result.registered).toBe(true)
    // Only the list call — no POST
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back visibly (audited) when the token lacks org-hook scope (403 on list)', async () => {
    process.env['ANWAY_PUBLIC_URL'] = 'https://anway.example.com'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    const result = await ensureGithubWebhook('t-1', 'conn-1', { token: 'tok', org: 'acme' })
    expect(result.registered).toBe(false)
    expect(result.reason).toBe('list_hooks_http_403')
    expect(appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'connector.webhook_registration_failed' }))
  })
})
