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
})
