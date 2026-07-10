import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('SnykBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.SnykBootstrap).toBeDefined()
  })

  it('returns a legitimate empty result when no token is configured, without ever calling fetch', async () => {
    const { SnykBootstrap } = await import('../bootstrap.js')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await new SnykBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('no API token configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression test: both the top-level and per-org catch previously
  // swallowed every failure (invalid token, network outage, malformed
  // JSON) as a plausible success — a completely invalid token would fail
  // the orgs call and report "0 projects across 0 orgs indexed", identical
  // to a genuinely empty Snyk account.
  it('throws when the orgs call fails with a real error', async () => {
    const { SnykBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(new SnykBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'bad' }))
      .rejects.toThrow(/HTTP 401/)
  })

  it('treats a 403 on one specific org as a legitimate per-org permission gap, continuing with others', async () => {
    const { SnykBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rest/orgs/org-a/')) return { ok: false, status: 403, json: async () => ({}) }
      if (url.includes('/rest/orgs/org-b/')) return { ok: true, json: async () => ({ data: [{ id: 'p1', attributes: { name: 'payments-api' } }] }) }
      if (url.includes('/rest/orgs')) return { ok: true, json: async () => ({ data: [{ id: 'org-a', attributes: { name: 'A' } }, { id: 'org-b', attributes: { name: 'B' } }] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }))
    const kg = new FakeKG()
    const result = await new SnykBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'real' })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'payments-api')).toBe(true)
  })

  it('throws when a per-org projects call fails with a real (non-403/404) error', async () => {
    const { SnykBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rest/orgs/org-a/')) return { ok: false, status: 500, json: async () => ({}) }
      if (url.includes('/rest/orgs')) return { ok: true, json: async () => ({ data: [{ id: 'org-a', attributes: { name: 'A' } }] }) }
      return { ok: false, status: 500, json: async () => ({}) }
    }))
    await expect(new SnykBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'real' }))
      .rejects.toThrow(/HTTP 500/)
  })
})
