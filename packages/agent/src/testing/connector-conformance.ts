/**
 * Connector bootstrap conformance harness (C0).
 *
 * Every connector bootstrap MUST pass this shared contract. Import it in the
 * connector's test file and call `describeConnectorConformance(name, cfg)`.
 *
 * Contract enforced:
 *  1. Idempotent — running bootstrap twice against the same graph yields the
 *     same entity count (no duplicates; merge on type+name).
 *  2. Every upserted entity carries `metadata.connectorCoordinates` — graph
 *     coordinates are the whole point; an entity without them is useless to
 *     targeted connector calls.
 *  3. Unreachable endpoint THROWS — never silently returns empty. A silent []
 *     looks identical to "connector healthy, nothing found" and rots the graph.
 *  4. `episodeHints` non-empty on success — the episodic layer needs text.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { TenantId } from '@anvay/types'
import type {
  IKnowledgeGraph, EntitySpec, RelationshipSpec, Episode, Fact, Entity, Relationship,
  KBEntry, AgentContext,
} from '../interfaces/knowledge-graph.js'
import type { IConnectorBootstrap } from '../graph-builder/bootstrap.js'

const CONFORMANCE_TENANT = '00000000-0000-0000-0000-000000000001' as TenantId

/** In-memory IKnowledgeGraph that records upserts; bootstrap-only methods work, rest throw. */
export class FakeKnowledgeGraph implements IKnowledgeGraph {
  readonly entities: EntitySpec[] = []
  readonly relationships: RelationshipSpec[] = []

  async upsertEntity(entity: EntitySpec, _tenantId: TenantId): Promise<string> {
    const key = `${entity.type}:${entity.name}`
    if (!this.entities.some((e) => `${e.type}:${e.name}` === key)) this.entities.push(entity)
    return key
  }
  async upsertRelationship(rel: RelationshipSpec, _tenantId: TenantId): Promise<string> {
    const key = `${rel.fromEntityId}-${rel.relType}-${rel.toEntityId}`
    if (!this.relationships.some((r) => `${r.fromEntityId}-${r.relType}-${r.toEntityId}` === key)) {
      this.relationships.push(rel)
    }
    return key
  }
  // Methods a bootstrap must not call — fail loudly if it does.
  async addEpisode(_e: Episode): Promise<void> { throw new Error('conformance: addEpisode not expected in bootstrap') }
  async getFacts(_q: string, _t?: string, _at?: Date): Promise<Fact[]> { throw new Error('conformance: getFacts not expected') }
  async getEntity(_id: string, _t: TenantId): Promise<Entity | null> { throw new Error('conformance: getEntity not expected') }
  async getRelationships(_id: string, _t: TenantId, _rt?: string): Promise<Relationship[]> { throw new Error('conformance: getRelationships not expected') }
  async search(_q: string, _t: TenantId, _k: number): Promise<KBEntry[]> { throw new Error('conformance: search not expected') }
  async resolveContext(_id: string, _t: TenantId, _d?: number): Promise<AgentContext> { throw new Error('conformance: resolveContext not expected') }
  async resolveContextByName(_n: string, _t: TenantId, _d?: number): Promise<AgentContext | null> { throw new Error('conformance: resolveContextByName not expected') }
  async markConnectorEntitiesStale(_c: string, _t: TenantId): Promise<number> { throw new Error('conformance: markConnectorEntitiesStale not expected') }
  async getEntityByExternalRef(_e: string, _t: TenantId): Promise<string | null> { throw new Error('conformance: getEntityByExternalRef not expected') }
}

export interface ConformanceConfig {
  /** Build the bootstrap under test against the provided fake graph. */
  makeBootstrap: (kg: IKnowledgeGraph) => IConnectorBootstrap
  /** Payload that reaches a (mocked) reachable endpoint and yields ≥1 entity. */
  validPayload: Record<string, unknown>
  /** Payload pointing at an unreachable endpoint — bootstrap must throw. */
  unreachablePayload: Record<string, unknown>
  /** Install HTTP mocks for validPayload (e.g. undici MockAgent). */
  setupMock?: () => void | Promise<void>
  /** Tear down mocks. */
  teardownMock?: () => void | Promise<void>
}

export function describeConnectorConformance(name: string, cfg: ConformanceConfig): void {
  describe(`${name} bootstrap — conformance (C0)`, () => {
    if (cfg.setupMock) beforeEach(async () => { await cfg.setupMock!() })
    if (cfg.teardownMock) afterEach(async () => { await cfg.teardownMock!() })

    it('produces at least one entity from a reachable endpoint', async () => {
      const kg = new FakeKnowledgeGraph()
      const res = await cfg.makeBootstrap(kg).bootstrap(CONFORMANCE_TENANT, 'conf', cfg.validPayload)
      expect(kg.entities.length, 'bootstrap must extract ≥1 entity').toBeGreaterThan(0)
      expect(res.entitiesUpserted, 'result.entitiesUpserted must match graph writes').toBe(kg.entities.length)
    })

    it('is idempotent — two runs on the same graph give identical entity count', async () => {
      const kg = new FakeKnowledgeGraph()
      const b = cfg.makeBootstrap(kg)
      await b.bootstrap(CONFORMANCE_TENANT, 'conf', cfg.validPayload)
      const afterFirst = kg.entities.length
      await b.bootstrap(CONFORMANCE_TENANT, 'conf', cfg.validPayload)
      expect(kg.entities.length, 'second run must not duplicate entities').toBe(afterFirst)
    })

    it('every entity carries metadata.connectorCoordinates', async () => {
      const kg = new FakeKnowledgeGraph()
      await cfg.makeBootstrap(kg).bootstrap(CONFORMANCE_TENANT, 'conf', cfg.validPayload)
      for (const e of kg.entities) {
        const coords = (e.metadata as { connectorCoordinates?: unknown } | undefined)?.connectorCoordinates
        expect(coords, `entity "${e.name}" is missing connectorCoordinates`).toBeTruthy()
      }
    })

    it('throws on an unreachable endpoint (no silent empty)', async () => {
      const kg = new FakeKnowledgeGraph()
      await expect(
        cfg.makeBootstrap(kg).bootstrap(CONFORMANCE_TENANT, 'conf', cfg.unreachablePayload),
      ).rejects.toThrow()
    })

    it('returns non-empty episodeHints on success', async () => {
      const kg = new FakeKnowledgeGraph()
      const res = await cfg.makeBootstrap(kg).bootstrap(CONFORMANCE_TENANT, 'conf', cfg.validPayload)
      expect(res.episodeHints.length, 'episodeHints must be non-empty on success').toBeGreaterThan(0)
    })
  })
}
