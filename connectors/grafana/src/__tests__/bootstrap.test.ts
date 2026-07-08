import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('GrafanaBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.GrafanaBootstrap).toBeDefined()
  })

  // Regression test: each of the 3 fetches previously treated ANY
  // non-ok response as "0 results", and the outer catch swallowed
  // connection errors too — a completely invalid token would 401 on all
  // three and report a plausible "0 dashboards, 0 alert rules, 0
  // datasources" success, identical to a genuinely empty instance.
  it('treats 401 on every endpoint as a legitimate per-endpoint gap, not fatal', async () => {
    const { GrafanaBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    const result = await new GrafanaBootstrap(new FakeKG(), 'https://grafana.example.com', 'bad-token').bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
  })

  it('throws when one endpoint returns a real (non-401/403) server error', async () => {
    const { GrafanaBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/search')) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => ([]) }
    }))
    await expect(new GrafanaBootstrap(new FakeKG(), 'https://grafana.example.com', 'token').bootstrap(tenantId, 'conn-1', {}))
      .rejects.toThrow(/HTTP 500/)
  })

  it('treats a connection-level failure as legitimately empty, not fatal', async () => {
    const { GrafanaBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const result = await new GrafanaBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('unreachable')
  })

  it('bootstraps real dashboards/alerts/datasources into entities on success', async () => {
    const { GrafanaBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/search')) return { ok: true, json: async () => ([{ uid: 'd1', title: 'Payments Overview' }]) }
      if (url.includes('/api/v1/provisioning/alert-rules')) return { ok: true, json: async () => ([{ uid: 'a1', title: 'high-error-rate' }]) }
      if (url.includes('/api/datasources')) return { ok: true, json: async () => ([{ uid: 'ds1', name: 'prometheus', type: 'prometheus' }]) }
      return { ok: true, json: async () => ([]) }
    }))
    const kg = new FakeKG()
    const result = await new GrafanaBootstrap(kg, 'https://grafana.example.com', 'token').bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(3)
    expect(kg.entities.some((e) => e.name === 'Payments Overview')).toBe(true)
    expect(kg.entities.some((e) => e.name === 'high-error-rate')).toBe(true)
    expect(kg.entities.some((e) => e.name === 'prometheus')).toBe(true)
  })
})
