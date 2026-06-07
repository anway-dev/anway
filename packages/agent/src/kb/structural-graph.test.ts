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
})
