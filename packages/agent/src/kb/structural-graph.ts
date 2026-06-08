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

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>

export class StructuralGraph implements IKnowledgeGraph {
  constructor(private readonly queryFn: QueryFn) {}

  private async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.queryFn(sql, params) as Promise<T[]>
  }

  async addEpisode(_episode: Episode): Promise<void> {
    throw new Error('Episodic layer not implemented — use Graphiti')
  }

  async getFacts(_query: string, _at?: Date): Promise<Fact[]> {
    throw new Error('Episodic layer not implemented — use Graphiti')
  }

  async getEntity(id: string, tenantId: TenantId): Promise<Entity | null> {
    const rows = await this.query<Entity>(
      'SELECT id, tenant_id AS "tenantId", type, name, metadata FROM entities WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    )
    return rows[0] ?? null
  }

  private async getRelationshipsBatch(entityIds: string[], tenantId: TenantId): Promise<Relationship[]> {
    if (entityIds.length === 0) return []
    return this.query<Relationship>(
      `SELECT id, tenant_id AS "tenantId", from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId", metadata
       FROM relationships
       WHERE (from_entity_id = ANY($1::uuid[]) OR to_entity_id = ANY($1::uuid[]))
         AND tenant_id = $2`,
      [entityIds, tenantId],
    )
  }

  private async getEntitiesBatch(ids: string[], tenantId: TenantId): Promise<Entity[]> {
    if (ids.length === 0) return []
    return this.query<Entity>(
      'SELECT id, tenant_id AS "tenantId", type, name, metadata FROM entities WHERE id = ANY($1::uuid[]) AND tenant_id = $2',
      [ids, tenantId],
    )
  }

  async getRelationships(entityId: string, tenantId: TenantId, relType?: string): Promise<Relationship[]> {
    let sql = `SELECT id, tenant_id AS "tenantId", from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId", metadata
               FROM relationships WHERE (from_entity_id = $1 OR to_entity_id = $1) AND tenant_id = $2`
    const params: unknown[] = [entityId, tenantId]
    if (relType) {
      sql += ' AND rel_type = $3'
      params.push(relType)
    }
    return this.query<Relationship>(sql, params)
  }

  async search(_query: string, _tenantId: TenantId, _topK: number): Promise<KBEntry[]> {
    throw new Error('Semantic search requires pgvector — use RAG pipeline')
  }

  async resolveContext(entityId: string, tenantId: TenantId, depth = 3): Promise<AgentContext> {
    const entity = await this.getEntity(entityId, tenantId)
    if (!entity) throw new Error(`Entity ${entityId} not found`)

    const visited = new Set<string>([entityId])
    const relatedEntitiesMap = new Map<string, Entity>()
    const allRelationships: Relationship[] = []
    let currentDepth = 0
    let toVisit = [entityId]

    while (toVisit.length > 0 && currentDepth < depth) {
      const rels = await this.getRelationshipsBatch(toVisit, tenantId)
      const nextSet = new Set<string>()
      for (const rel of rels) {
        allRelationships.push(rel)
        const otherId = rel.fromEntityId === toVisit.find(eid => eid === rel.fromEntityId || eid === rel.toEntityId)
          ? rel.toEntityId : rel.fromEntityId
        if (!visited.has(otherId)) nextSet.add(otherId)
      }
      for (const eid of toVisit) visited.add(eid)
      toVisit = [...nextSet].filter(eid => !visited.has(eid))
      currentDepth++
      if (toVisit.length > 0) {
        const entities = await this.getEntitiesBatch(toVisit, tenantId)
        for (const e of entities) relatedEntitiesMap.set(e.id, e)
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
    const rows = await this.query<{ id: string }>(
      `INSERT INTO entities (tenant_id, type, name, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, type, name) DO UPDATE
         SET metadata = EXCLUDED.metadata, updated_at = NOW()
       RETURNING id`,
      [tenantId, entity.type, entity.name, JSON.stringify(entity.metadata ?? {})],
    )
    return rows[0]!.id
  }

  async upsertRelationship(rel: RelationshipSpec, tenantId: TenantId): Promise<string> {
    const rows = await this.query<{ id: string }>(
      `INSERT INTO relationships (tenant_id, from_entity_id, rel_type, to_entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, from_entity_id, rel_type, to_entity_id)
	       DO UPDATE SET metadata = EXCLUDED.metadata
       RETURNING id`,
      [tenantId, rel.fromEntityId, rel.relType, rel.toEntityId, JSON.stringify(rel.metadata ?? {})],
    )
    return rows[0]?.id ?? ''
  }

  async resolveContextByName(name: string, tenantId: TenantId, depth = 2): Promise<AgentContext | null> {
    const rows = await this.query<{ id: string }>(
      `SELECT id FROM entities WHERE tenant_id = $1 AND name ILIKE $2 LIMIT 1`,
      [tenantId, `%${name}%`],
    )
    if (rows.length === 0) return null
    return this.resolveContext(rows[0]!.id, tenantId, depth)
  }

  async getEntityByExternalRef(externalId: string, tenantId: TenantId): Promise<string | null> {
    const rows = await this.query<{ id: string }>(
      `SELECT id FROM entities WHERE tenant_id = $1 AND metadata->>'externalId' = $2 LIMIT 1`,
      [tenantId, externalId],
    )
    return rows[0]?.id ?? null
  }
}
