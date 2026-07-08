import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('ElasticsearchBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.ElasticsearchBootstrap).toBeDefined()
  })

  // Regression test: `!res.ok` and the outer catch both previously
  // swallowed every failure (invalid credentials, network outage,
  // malformed JSON) as a plausible "connection failed" success with 0
  // entities — identical to a genuinely empty cluster.
  it('throws on a real API failure instead of reporting a false-clean empty success', async () => {
    const { ElasticsearchBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(new ElasticsearchBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { user: 'u', password: 'wrong' }))
      .rejects.toThrow(/HTTP 401/)
  })

  it('treats a connection-level failure (cluster unreachable) as legitimately empty, not fatal', async () => {
    const { ElasticsearchBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:9200') }))
    const result = await new ElasticsearchBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('unreachable')
  })

  it('bootstraps real indices into entities, skipping system indices, on success', async () => {
    const { ElasticsearchBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ([
        { index: '.kibana', 'docs.count': '3' },
        { index: 'app-logs', 'docs.count': '1000' },
      ]),
    })))
    const kg = new FakeKG()
    const result = await new ElasticsearchBootstrap(kg).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'app-logs')).toBe(true)
    expect(kg.entities.some((e) => e.name === '.kibana')).toBe(false)
  })
})
