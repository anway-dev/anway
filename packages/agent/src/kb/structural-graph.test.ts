import { describe, it, expect, vi } from 'vitest'
import { StructuralGraph } from './structural-graph.js'

function makeMockQuery(rows: Record<string, unknown>[] = []) {
  return vi.fn().mockResolvedValue(rows)
}

describe('StructuralGraph', () => {
  describe('upsertEntity', () => {
    it('is idempotent — same entity returns the same id', async () => {
      const query = makeMockQuery([{ id: 'uuid-1' }])
      const kg = new StructuralGraph(query as unknown as (sql: string, params?: unknown[]) => Promise<unknown[]>)
      const id1 = await kg.upsertEntity({ type: 'Service', name: 'test-svc' }, 'tenant-1' as any)
      const id2 = await kg.upsertEntity({ type: 'Service', name: 'test-svc' }, 'tenant-1' as any)
      expect(id1).toBe('uuid-1')
      expect(id2).toBe('uuid-1')
    })

    // Regression test: the merge upsert previously never bumped
    // updated_at, so it stayed frozen at INSERT time forever and
    // entity-level freshness had no signal to decay from.
    it('bumps updated_at on every upsert so entity freshness has a real signal', async () => {
      const query = makeMockQuery([{ id: 'uuid-1' }])
      const kg = new StructuralGraph(query as any)
      await kg.upsertEntity({ type: 'Service', name: 'test-svc' }, 'tenant-1' as any)
      expect(query.mock.calls[0]?.[0]).toContain('updated_at = NOW()')
    })
  })

  describe('resolveContext freshness', () => {
    // Regression test: freshness previously came only from a content-ILIKE
    // heuristic against kb_entries — an entity with no string-matching
    // kb_entry served as freshness 1.0 regardless of its own age. Entity
    // updated_at staleness is now the primary signal; the overall value is
    // min(entityFreshness, kbFreshness).
    it('bounds freshness by the entity\'s own updated_at staleness, not just kb_entries', async () => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('FROM entities WHERE id') && sql.includes('SELECT id')) {
          return [{ id: 'e-1', tenantId: 'tenant-1', type: 'Service', name: 'payments-api', metadata: {} }]
        }
        if (sql.includes('entity_graph')) return []
        if (sql.includes('FROM relationships')) return []
        if (sql.includes('AS ef')) return [{ ef: 0.3 }]   // stale entity (decayed)
        if (sql.includes('kb_entries')) return []          // no kb_entries match at all
        if (sql.includes('kb_episodes')) return []
        return []
      })
      const kg = new StructuralGraph(query as any)
      const ctx = await kg.resolveContext('e-1', 'tenant-1' as any, 1)
      // Old behavior: no kb_entries match → 1.0. New: entity staleness wins.
      expect(ctx.freshness).toBe(0.3)
    })

    it('takes the lower of entity staleness and kb_entries score', async () => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('FROM entities WHERE id') && sql.includes('SELECT id')) {
          return [{ id: 'e-1', tenantId: 'tenant-1', type: 'Service', name: 'payments-api', metadata: {} }]
        }
        if (sql.includes('entity_graph')) return []
        if (sql.includes('FROM relationships')) return []
        if (sql.includes('AS ef')) return [{ ef: 0.9 }]     // fresh entity
        if (sql.includes('kb_entries')) return [{ fs: 0.4 }] // stale kb entry
        if (sql.includes('kb_episodes')) return []
        return []
      })
      const kg = new StructuralGraph(query as any)
      const ctx = await kg.resolveContext('e-1', 'tenant-1' as any, 1)
      expect(ctx.freshness).toBe(0.4)
    })
  })

  describe('getEntity', () => {
    it('returns null for non-existent entity', async () => {
      const query = makeMockQuery([])
      const kg = new StructuralGraph(query as any)
      const result = await kg.getEntity('non-existent', 'tenant-1' as any)
      expect(result).toBeNull()
    })
  })

  describe('resolveContextByName', () => {
    it('returns null when name not found', async () => {
      const query = makeMockQuery([])
      const kg = new StructuralGraph(query as any)
      const result = await kg.resolveContextByName('unknown', 'tenant-1' as any)
      expect(result).toBeNull()
    })
  })

  describe('search', () => {
    it('uses pgvector when embedder provided', async () => {
      const pgRows = [{
        id: 'e1', content: 'payments svc',
        fetched_at: new Date('2026-01-01'),
        ttl_seconds: 120, freshness_score: 0.9, source: 'datadog',
      }]
      const query = makeMockQuery(pgRows)
      const embedder = { embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]) }
      const kg = new StructuralGraph(query as any, embedder)
      const results = await kg.search('payments', 'tenant-1' as any, 5)
      expect(results[0]?.content).toBe('payments svc')
      expect(results[0]?.id).toBe('e1')
      expect(query.mock.calls[0]?.[0]).toContain('kb_entries')
      expect(query.mock.calls[0]?.[0]).toContain('<=>')
    })

    it('falls back to ILIKE when no embedder', async () => {
      const episodeRows = [{ text: 'some episode', created_at: new Date('2026-01-01') }]
      const query = makeMockQuery(episodeRows)
      const kg = new StructuralGraph(query as any)
      const results = await kg.search('episode', 'tenant-1' as any, 5)
      expect(results[0]?.content).toBe('some episode')
      expect(query.mock.calls[0]?.[0]).toContain('kb_episodes')
    })

    it('falls back to ILIKE when embedder throws', async () => {
      const episodeRows = [{ text: 'fallback result', created_at: new Date('2026-01-01') }]
      const query = makeMockQuery(episodeRows)
      const embedder = { embed: vi.fn().mockRejectedValue(new Error('embed failed')) }
      const kg = new StructuralGraph(query as any, embedder)
      const results = await kg.search('test', 'tenant-1' as any, 5)
      expect(results[0]?.content).toBe('fallback result')
      expect(query.mock.calls[0]?.[0]).toContain('kb_episodes')
    })
  })

  describe('getFacts', () => {
    // Regression test for finding I6: `query` was previously ignored
    // entirely (prefixed `_query`, never referenced in SQL) — every call
    // returned the last 50 episodes in the time window regardless of
    // relevance. Now must be passed through as an ILIKE filter param.
    it('passes the query text through as a real filter, not just a time window', async () => {
      const query = makeMockQuery([{ text: 'payments-api spike', created_at: new Date('2026-01-01') }])
      const kg = new StructuralGraph(query as any)
      await kg.getFacts('payments-api', 'tenant-1' as any)
      const [sql, params] = query.mock.calls[0]!
      expect(sql).toContain('ILIKE')
      expect(params).toContain('payments-api')
    })

    // Regression test for finding I6: `at` previously used `created_at >= since`,
    // which returns episodes *after* the requested point in time — the
    // opposite of "facts as they stood at time T". Must be an upper bound
    // (<=), not a lower bound.
    it('treats `at` as a point-in-time upper bound, not a lower bound', async () => {
      const query = makeMockQuery([])
      const kg = new StructuralGraph(query as any)
      const at = new Date('2026-03-15T00:00:00Z')
      await kg.getFacts('q', 'tenant-1' as any, at)
      const [sql, params] = query.mock.calls[0]!
      expect(sql).toContain('created_at <= $2')
      expect((params as unknown[])[1]).toBe(at)
    })
  })
})
