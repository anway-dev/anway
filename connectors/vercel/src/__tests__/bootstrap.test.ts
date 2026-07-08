import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('VercelBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.VercelBootstrap).toBeDefined()
  })

  it('returns a legitimate empty result when no token is configured, without ever calling fetch', async () => {
    const { VercelBootstrap } = await import('../bootstrap.js')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await new VercelBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('no API token configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression test: `!res.ok` and the outer catch both previously
  // swallowed every failure (invalid token, network outage, malformed
  // JSON) as a plausible "API/connection failed" success with 0 entities.
  it('throws on a real API failure instead of reporting a false-clean empty success', async () => {
    const { VercelBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(new VercelBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'bad' }))
      .rejects.toThrow(/HTTP 401/)
  })

  it('bootstraps real projects into entities on success', async () => {
    const { VercelBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ projects: [{ id: 'p1', name: 'payments-web' }] }) })))
    const kg = new FakeKG()
    const result = await new VercelBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'real' })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'payments-web')).toBe(true)
  })
})
