import type { TenantId } from '@anvay/types'
import type {
  IKnowledgeGraph,
  Entity,
  Relationship,
  KBEntry,
  Episode,
  Fact,
  AgentContext,
  EntitySpec,
  RelationshipSpec,
  GroundingSource,
  ConnectorCoordinates,
} from '../interfaces/knowledge-graph.js'

type DbPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}

export class StructuralGraph implements IKnowledgeGraph {
  constructor(private readonly pool: DbPool) {}

  async addEpisode(_episode: Episode): Promise<void> {
    throw new Error('Episodic layer not implemented — use Graphiti')
  }

  async getFacts(_query: string, _at?: Date): Promise<Fact[]> {
    throw new Error('Episodic layer not implemented — use Graphiti')
  }

  async getEntity(id: string, tenantId: TenantId): Promise<Entity | null> {
    const result = await this.pool.query(
      'SELECT id, tenant_id AS "tenantId", type, name, metadata FROM entities WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    )
    if (result.rows.length === 0) return null
    return result.rows[0] as unknown as Entity
  }

  async getRelationships(entityId: string, tenantId: TenantId, relType?: string): Promise<Relationship[]> {
    let sql = `SELECT id, tenant_id AS "tenantId", from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId", metadata
               FROM relationships WHERE (from_entity_id = $1 OR to_entity_id = $1) AND tenant_id = $2`
    const params: unknown[] = [entityId, tenantId]
    if (relType) {
      sql += ' AND rel_type = $3'
      params.push(relType)
    }
    const result = await this.pool.query(sql, params)
    return result.rows as unknown as Relationship[]
  }

  async search(_query: string, _tenantId: TenantId, _topK: number): Promise<KBEntry[]> {
    throw new Error('Semantic search requires pgvector — use RAG pipeline')
  }

  async resolveContext(entityId: string, tenantId: TenantId, depth = 3): Promise<AgentContext> {
    const entity = await this.getEntity(entityId, tenantId)
    if (!entity) throw new Error(`Entity ${entityId} not found`)

    const visited = new Set<string>()
    const relatedEntitiesMap = new Map<string, Entity>()
    const allRelationships: Relationship[] = []
    let currentDepth = 0
    let toVisit = [entityId]

    while (toVisit.length > 0 && currentDepth < depth) {
      const nextBatch: string[] = []
      for (const eid of toVisit) {
        if (visited.has(eid)) continue
        visited.add(eid)
        const rels = await this.getRelationships(eid, tenantId)
        for (const rel of rels) {
          allRelationships.push(rel)
          const otherId = rel.fromEntityId === eid ? rel.toEntityId : rel.fromEntityId
          if (!visited.has(otherId)) nextBatch.push(otherId)
        }
      }
      toVisit = nextBatch
      currentDepth++
      for (const eid of toVisit) {
        if (!relatedEntitiesMap.has(eid)) {
          const e = await this.getEntity(eid, tenantId)
          if (e) relatedEntitiesMap.set(eid, e)
        }
      }
    }

    return {
      primaryEntity: entity,
      relatedEntities: [...relatedEntitiesMap.values()],
      relationships: allRelationships,
      recentEpisodes: [],
      connectorCoordinates: {} as Record<string, ConnectorCoordinates>,
      groundingSources: [] as GroundingSource[],
      freshness: 1.0,
    }
  }

  async upsertEntity(entity: EntitySpec, tenantId: TenantId): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO entities (tenant_id, type, name, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, type, name) DO UPDATE
         SET metadata = EXCLUDED.metadata, updated_at = NOW()
       RETURNING id`,
      [tenantId, entity.type, entity.name, JSON.stringify(entity.metadata ?? {})],
    )
    return result.rows[0]!.id as string
  }

  async upsertRelationship(rel: RelationshipSpec, tenantId: TenantId): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO relationships (tenant_id, from_entity_id, rel_type, to_entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (from_entity_id, rel_type, to_entity_id) DO NOTHING
       RETURNING id`,
      [tenantId, rel.fromEntityId, rel.relType, rel.toEntityId, JSON.stringify(rel.metadata ?? {})],
    )
    return result.rows[0]?.id as string ?? ''
  }

  async resolveContextByName(name: string, tenantId: TenantId, depth = 2): Promise<AgentContext | null> {
    const result = await this.pool.query(
      `SELECT id FROM entities WHERE tenant_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [tenantId, name],
    )
    const rows = result.rows as Record<string, unknown>[]
    if (rows.length === 0) return null
    return this.resolveContext(rows[0]!.id as string, tenantId, depth)
  }

  async getEntityByExternalRef(externalId: string, tenantId: TenantId): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT id FROM entities WHERE tenant_id = $1 AND metadata->>'externalId' = $2 LIMIT 1`,
      [tenantId, externalId],
    )
    const rows = result.rows as Record<string, unknown>[]
    return (rows[0]?.id as string) ?? null
  }
}
