import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('LokiBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.LokiBootstrap).toBeDefined()
  })

  it('treats a connection-level failure as legitimately empty, not fatal', async () => {
    const { LokiBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const result = await new LokiBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('unreachable')
  })

  it('falls back to the job label when service_name has no data (both legitimate)', async () => {
    const { LokiBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('service_name')) return { ok: true, json: async () => ({ status: 'success' }) }
      return { ok: true, json: async () => ({ data: ['payments-api'] }) }
    }))
    const kg = new FakeKG()
    const result = await new LokiBootstrap(kg).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'payments-api')).toBe(true)
  })

  // Regression test: the fallback (job label) call previously returned
  // empty for ANY non-200 response — a real auth/outage failure on the
  // second call looked identical to "this Loki setup has neither label
  // configured", the one legitimate empty case.
  it('throws when the fallback label call fails with a real HTTP error', async () => {
    const { LokiBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('service_name')) return { ok: true, json: async () => ({ status: 'success' }) }
      return { ok: false, status: 401, json: async () => ({}) }
    }))
    await expect(new LokiBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})).rejects.toThrow(/HTTP 401/)
  })

  it('bootstraps real services from the service_name label on success', async () => {
    const { LokiBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: ['checkout-api'] }) })))
    const kg = new FakeKG()
    const result = await new LokiBootstrap(kg).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'checkout-api')).toBe(true)
  })
})
