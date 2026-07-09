import { describe, it, expect, vi, beforeEach } from 'vitest'

const serviceQr = vi.fn()
vi.mock('../db/client.js', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => serviceQr(...args) },
}))
const er = vi.fn()
vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
    fn({ $executeRaw: er, $queryRaw: vi.fn() })
  ),
}))
vi.mock('../utils/crypto.js', () => ({
  decryptJson: vi.fn(() => ({ token: 'tok', org: 'acme' })),
  encryptJson: vi.fn((v: unknown) => JSON.stringify(v)),
}))
const publishDurableMock = vi.fn(async () => {})
const stampMock = vi.fn(async () => {})
vi.mock('./durable-events.js', () => ({ publishDurable: (...a: unknown[]) => publishDurableMock(...a) }))
vi.mock('./webhook-registrar.js', () => ({ stampEventReceived: (...a: unknown[]) => stampMock(...a) }))

import { pollConnectorsOnce } from './connector-poller.js'

beforeEach(() => {
  serviceQr.mockReset()
  er.mockReset()
  publishDurableMock.mockClear()
  stampMock.mockClear()
  vi.unstubAllGlobals()
})

const row = (over?: Record<string, unknown>) => ({
  id: 'conn-1', tenant_id: 't-1', credentials_enc: 'enc', sync_state: {}, ...over,
})

describe('pollConnectorsOnce', () => {
  it('skips connectors whose vendor webhook is already registered — no double-delivery', async () => {
    serviceQr.mockResolvedValueOnce([row({ sync_state: { webhookRegisteredAt: '2026-01-01T00:00:00Z' } })])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await pollConnectorsOnce(null)
    expect(result.polled).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('emits a durable pr_merged event per merged PR found and advances the cursor', async () => {
    serviceQr.mockResolvedValueOnce([row()])
    er.mockResolvedValue(1)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('is%3Apr')
      expect(url).toContain('is%3Amerged')
      return {
        ok: true,
        json: async () => ({
          items: [{
            number: 12, title: 'Fix checkout race',
            user: { login: 'raj' },
            repository_url: 'https://api.github.com/repos/acme/payments-api',
          }],
        }),
      }
    }))

    const result = await pollConnectorsOnce(null)
    expect(result.eventsEmitted).toBe(1)
    expect(publishDurableMock).toHaveBeenCalledWith(null, 't-1', 'pr_merged', expect.objectContaining({
      repo: 'acme/payments-api', prNumber: 12, author: 'raj',
    }))
    expect(stampMock).toHaveBeenCalledWith('t-1', 'conn-1')
    expect(er).toHaveBeenCalled() // cursor persisted
  })

  it('does not stamp liveness or emit events when nothing merged since the cursor', async () => {
    serviceQr.mockResolvedValueOnce([row()])
    er.mockResolvedValue(1)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))
    const result = await pollConnectorsOnce(null)
    expect(result.eventsEmitted).toBe(0)
    expect(stampMock).not.toHaveBeenCalled()
    expect(er).toHaveBeenCalled() // cursor still advances
  })

  it('a failed poll for one connector does not abort the cycle for others', async () => {
    serviceQr.mockResolvedValueOnce([row(), row({ id: 'conn-2', tenant_id: 't-2' })])
    er.mockResolvedValue(1)
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) return { ok: false, status: 403, json: async () => ({}) }
      return { ok: true, json: async () => ({ items: [{ number: 1, title: 'x', repository_url: 'https://api.github.com/repos/acme/x' }] }) }
    }))
    const result = await pollConnectorsOnce(null)
    expect(result.polled).toBe(2)
    expect(result.eventsEmitted).toBe(1)
  })
})
