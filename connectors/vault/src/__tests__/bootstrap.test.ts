import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('VaultBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.VaultBootstrap).toBeDefined()
  })

  it('treats a connection-level failure as legitimately unreachable, not fatal', async () => {
    const { VaultBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const result = await new VaultBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'real-token' })
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('unreachable')
  })

  // Regression test: previously a persistent non-ok response after
  // exhausting the retry loop was reported as the same generic
  // "connection failed" empty success regardless of whether a real token
  // was ever provided — a genuinely invalid token looked identical to
  // "Vault isn't reachable at all".
  describe('with a real token provided but every retry still failing', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('throws instead of reporting a false-clean empty success', async () => {
      const { VaultBootstrap } = await import('../bootstrap.js')
      const bootstrapPromise = new VaultBootstrap(new FakeKG()).bootstrap(tenantId, 'conn-1', { token: 'real-but-invalid' })
      const assertion = expect(bootstrapPromise).rejects.toThrow(/HTTP 403/)
      await vi.advanceTimersByTimeAsync(5_000)
      await assertion
    })
  })

  it('bootstraps real secret engine mounts into entities on success', async () => {
    const { VaultBootstrap } = await import('../bootstrap.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ 'secret/': { type: 'kv', description: 'app secrets' } }),
    })))
    const kg = new FakeKG()
    const result = await new VaultBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'real-token' })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'secret')).toBe(true)
  })
})
