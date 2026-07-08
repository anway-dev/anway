import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('SonarQubeBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.SonarQubeBootstrap).toBeDefined()
  })

  it('treats a connection-level failure as legitimately empty, not fatal', async () => {
    const { SonarQubeBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const result = await new SonarQubeBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('unreachable')
  })

  // Regression test: `!res.ok` and the outer catch both previously
  // swallowed every failure (invalid token, network outage, malformed
  // JSON) as a plausible "connection failed" success with 0 entities.
  it('throws on a real HTTP error instead of reporting a false-clean empty success', async () => {
    const { SonarQubeBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(new SonarQubeBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'bad' }))
      .rejects.toThrow(/HTTP 401/)
  })

  it('bootstraps real projects into entities on success', async () => {
    const { SonarQubeBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ components: [{ key: 'payments-api', name: 'payments-api', qualifier: 'TRK' }] }),
    })))
    const kg = new FakeKG()
    const result = await new SonarQubeBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'real' })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'payments-api')).toBe(true)
  })
})
