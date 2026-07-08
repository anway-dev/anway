import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VaultAgent } from './agent.js'
import { VaultBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('vault conformance', () => {
  it('agent exposes tools', () => {
    const agent = new VaultAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('vault')
  })

  it('agent tools have valid definitions', () => {
    const agent = new VaultAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  describe('bootstrap (no real Vault dev server reachable)', () => {
    // bootstrap.ts retries up to 5x with a 1s backoff when no real Vault dev
    // server is reachable at the default localhost:8200. Previously this
    // test let that retry loop run for real — 4 real 1s sleeps plus 5 real
    // TCP connect attempts, whose combined wall-clock time is sensitive to
    // system load (observed exceeding both a 10s and a 20s timeout on a
    // loaded machine, under parallel `pnpm test` runs). A conformance unit
    // test shouldn't depend on real network I/O or real wall-clock timing at
    // all — mocking fetch (always rejects, instant) and using fake timers
    // (advance through the 4 backoff sleeps synchronously) exercises the
    // exact same real retry logic in bootstrap.ts deterministically and fast.
    beforeEach(() => {
      vi.useFakeTimers()
      // bootstrap.ts's retry loop only retries on a resolved-but-not-ok
      // response (matching its own real scenario: "Vault dev containers can
      // return health OK before the root token is fully provisioned") — a
      // rejected fetch (real connection failure) instead short-circuits
      // straight to the outer catch on the first attempt, so this must
      // resolve, not reject, to exercise all 5 retry attempts.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it('returns valid result structure', async () => {
      const kg = new FakeKnowledgeGraph()
      const bootstrapPromise = new VaultBootstrap(kg).bootstrap(
        '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
      )
      // Advance through all 5 real 1s backoff sleeps — bootstrap.ts's loop
      // sleeps after every attempt including the last one, not just between
      // attempts (5 sleeps total, not 4 — confirmed by this test hanging
      // and hitting vitest's real 5000ms default timeout when advanced by
      // only 4000ms).
      await vi.advanceTimersByTimeAsync(5_000)
      const result = await bootstrapPromise

      expect(result.entitiesUpserted).toBe(0)
      // Confirmed live via independent review: this scenario is an empty
      // payload (no token) getting a resolved-but-not-ok response every
      // retry — not a connection failure at all (nothing here rejects).
      // Distinguishing "no token configured" (legitimate, this case) from
      // "a real token was provided and Vault still rejected it" (a real
      // auth/permission failure that must throw, not report a silent
      // empty success) required a more accurate message than the old
      // generic "connection failed", which the fix now uses.
      expect(result.episodeHints).toEqual(['Vault bootstrap: no token configured'])
      expect(fetch).toHaveBeenCalledTimes(5)
    })
  })
})
