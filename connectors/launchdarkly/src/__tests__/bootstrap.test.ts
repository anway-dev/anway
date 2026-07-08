import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('LaunchDarklyBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.LaunchDarklyBootstrap).toBeDefined()
  })

  it('returns a legitimate empty result when no API key is configured, without ever calling fetch', async () => {
    const { LaunchDarklyBootstrap } = await import('../bootstrap.js')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await new LaunchDarklyBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('no API key configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression test: `!res.ok` and the outer catch both previously
  // swallowed every failure (invalid key, network outage, malformed JSON)
  // as a plausible "API/connection failed" success with 0 entities.
  it('throws on a real API failure instead of reporting a false-clean empty success', async () => {
    const { LaunchDarklyBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(new LaunchDarklyBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { apiKey: 'bad-key' }))
      .rejects.toThrow(/HTTP 401/)
  })

  it('throws on a real connection failure instead of swallowing it', async () => {
    const { LaunchDarklyBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(new LaunchDarklyBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { apiKey: 'real-key' }))
      .rejects.toThrow(/fetch failed/)
  })

  it('bootstraps real projects into entities on success', async () => {
    const { LaunchDarklyBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ key: 'payments-api', name: 'Payments API' }] }) })))
    const kg = new FakeKG()
    const result = await new LaunchDarklyBootstrap(kg).bootstrap(tenantId, 'conn-1', { apiKey: 'real-key' })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'Payments API')).toBe(true)
  })
})
