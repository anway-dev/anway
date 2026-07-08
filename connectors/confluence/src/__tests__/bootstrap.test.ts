import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('ConfluenceBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.ConfluenceBootstrap).toBeDefined()
  })

  // Regression test: `if (spaceResp.ok)` with no else branch meant a real
  // auth/outage failure (401/403/5xx) on the top-level space list call
  // silently fell through to "no entities found" — identical to a
  // genuinely empty Confluence instance.
  it('throws when the top-level space list call fails with a real error', async () => {
    const { ConfluenceBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    const bootstrap = new ConfluenceBootstrap(new FakeKG(), 'https://x.atlassian.net', 'tok', 'a@b.com')
    await expect(bootstrap.bootstrap(tenantId, 'conn-1', {})).rejects.toThrow(/HTTP 401/)
  })

  it('treats a 403 on one specific space as a legitimate per-space permission gap, continuing with others', async () => {
    const { ConfluenceBootstrap } = await import('../bootstrap.js')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/space?')) {
        return { ok: true, json: async () => ({ results: [{ key: 'SEC', name: 'Secret' }, { key: 'PUB', name: 'Public' }] }) }
      }
      if (url.includes('/space/SEC/')) return { ok: false, status: 403, json: async () => ({}) }
      if (url.includes('/space/PUB/')) {
        return { ok: true, json: async () => ({ results: [{ id: 'p1', title: 'Runbook' }] }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const kg = new FakeKG()
    const bootstrap = new ConfluenceBootstrap(kg, 'https://x.atlassian.net', 'tok', 'a@b.com')
    const result = await bootstrap.bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'Runbook')).toBe(true)
  })

  it('throws when a per-space call fails with a real (non-403/404) error', async () => {
    const { ConfluenceBootstrap } = await import('../bootstrap.js')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/space?')) return { ok: true, json: async () => ({ results: [{ key: 'ENG', name: 'Engineering' }] }) }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const bootstrap = new ConfluenceBootstrap(new FakeKG(), 'https://x.atlassian.net', 'tok', 'a@b.com')
    await expect(bootstrap.bootstrap(tenantId, 'conn-1', {})).rejects.toThrow(/HTTP 500/)
  })
})
