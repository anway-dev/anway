import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('TerraformBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.TerraformBootstrap).toBeDefined()
  })

  it('returns a legitimate empty result when no token is configured, without ever calling fetch', async () => {
    const { TerraformBootstrap } = await import('../bootstrap.js')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await new TerraformBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('no API token configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression test: both the top-level and per-org catch previously
  // swallowed every failure (invalid token, network outage, malformed
  // JSON) as a plausible success — a completely invalid token would fail
  // the organizations call and report "0 workspaces across 0 orgs
  // indexed", identical to a genuinely empty Terraform Cloud account.
  it('throws when the organizations call fails with a real error', async () => {
    const { TerraformBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(new TerraformBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'bad' }))
      .rejects.toThrow(/HTTP 401/)
  })

  it('treats a 404 on one specific org workspaces call as a legitimate per-org permission gap', async () => {
    const { TerraformBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/organizations') && !url.includes('/workspaces')) {
        return { ok: true, json: async () => ({ data: [{ id: 'o1', attributes: { name: 'acme' } }] }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }))
    const kg = new FakeKG()
    const result = await new TerraformBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'real' })
    expect(result.entitiesUpserted).toBe(0)
  })

  it('throws when a per-org workspaces call fails with a real (non-403/404) error', async () => {
    const { TerraformBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/organizations') && !url.includes('/workspaces')) {
        return { ok: true, json: async () => ({ data: [{ id: 'o1', attributes: { name: 'acme' } }] }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    }))
    await expect(new TerraformBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'real' }))
      .rejects.toThrow(/HTTP 500/)
  })

  it('bootstraps real workspaces into entities on success', async () => {
    const { TerraformBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/organizations') && !url.includes('/workspaces')) {
        return { ok: true, json: async () => ({ data: [{ id: 'o1', attributes: { name: 'acme' } }] }) }
      }
      return { ok: true, json: async () => ({ data: [{ id: 'w1', attributes: { name: 'prod' } }] }) }
    }))
    const kg = new FakeKG()
    const result = await new TerraformBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'real' })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'acme/prod')).toBe(true)
  })
})
