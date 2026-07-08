import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('DynatraceBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.DynatraceBootstrap).toBeDefined()
  })

  it('returns a legitimate empty result when no token is configured, without ever calling fetch', async () => {
    const { DynatraceBootstrap } = await import('../bootstrap.js')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await new DynatraceBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { host: 'https://x.dynatrace.com' })
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('token required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression test: `!res.ok` and the outer catch both previously
  // swallowed every failure (invalid token, network outage, malformed
  // JSON) as a plausible "API call failed" success with 0 entities.
  it('throws on a real API failure instead of reporting a false-clean empty success', async () => {
    const { DynatraceBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(new DynatraceBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { host: 'https://x.dynatrace.com', token: 'bad' }))
      .rejects.toThrow(/HTTP 401/)
  })

  it('bootstraps real services into entities on success', async () => {
    const { DynatraceBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entities: [{ entityId: 'SERVICE-1', displayName: 'payments-api' }] }) })))
    const kg = new FakeKG()
    const result = await new DynatraceBootstrap(kg).bootstrap(tenantId, 'conn-1', { host: 'https://x.dynatrace.com', token: 'real' })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'payments-api')).toBe(true)
  })
})
