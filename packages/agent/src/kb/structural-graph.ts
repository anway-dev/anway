import type { TenantId } from '@anway/types'
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
import type { IEmbeddingProvider } from '../interfaces/provider.js'

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>

export class StructuralGraph implements IKnowledgeGraph {
  constructor(
    private readonly queryFn: QueryFn,
    private readonly embedder?: IEmbeddingProvider,
  ) {}

  private async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.queryFn(sql, params) as Promise<T[]>
  }

  async addEpisode(episode: Episode): Promise<void> {
    if (episode.tenantId) {
      await this.query(
        `INSERT INTO kb_episodes (tenant_id, text, metadata, created_at)
         VALUES ($1::uuid, $2, $3::jsonb, $4)`,
        [episode.tenantId, episode.text, JSON.stringify({ source: episode.source }), episode.timestamp],
      ).catch(() => {})
    } else {
      await this.query(
        `INSERT INTO kb_episodes (tenant_id, text, metadata, created_at)
         VALUES (current_setting('app.tenant_id', true)::uuid, $1, $2::jsonb, $3)`,
        [episode.text, JSON.stringify({ source: episode.source }), episode.timestamp],
      ).catch(() => {})
    }
  }

  // Previously ignored `query` entirely (parameter was prefixed `_query` and
  // never referenced in the SQL) — every call returned the last 50 episodes
  // in the time window regardless of relevance to the actual question asked.
  // Also inverted `at`'s semantics: `created_at >= since` returns episodes
  // *after* the requested point in time, the opposite of "facts as they
  // stood at time T" (a point-in-time / historical query would instead need
  // everything up to and including `at`). Confirmed live via independent
  // review as a real correctness bug in the interface's documented temporal
  // contract (IKnowledgeGraph.getFacts: "facts valid at time T").
  async getFacts(query: string, tenantId?: string, at?: Date): Promise<Fact[]> {
    const asOf = at ?? new Date()
    const windowStart = new Date(asOf.getTime() - 24 * 60 * 60 * 1000)
    const trimmedQuery = query.trim()
    const rows = await this.query<{ text: string; created_at: Date }>(
      `SELECT text, created_at FROM kb_episodes
       WHERE tenant_id = $1::uuid AND created_at <= $2 AND created_at >= $3
         AND ($4 = '' OR text ILIKE '%' || $4 || '%')
       ORDER BY created_at DESC LIMIT 50`,
      [tenantId ?? '', asOf, windowStart, trimmedQuery],
    ).catch(() => [])
    return rows.map(r => ({
      claim: r.text,
      source: 'kb_episodes',
      validFrom: new Date(r.created_at.getTime() - 60 * 60 * 1000),
      validTo: r.created_at,
      confidence: 1.0,
    }))
  }

  async getEntity(id: string, tenantId: TenantId): Promise<Entity | null> {
    const rows = await this.query<Entity>(
      'SELECT id, tenant_id AS "tenantId", type, name, metadata FROM entities WHERE id = $1::uuid AND tenant_id = $2::uuid',
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
         AND tenant_id = $2::uuid`,
      [entityIds, tenantId],
    )
  }

  private async getEntitiesBatch(ids: string[], tenantId: TenantId): Promise<Entity[]> {
    if (ids.length === 0) return []
    return this.query<Entity>(
      'SELECT id, tenant_id AS "tenantId", type, name, metadata FROM entities WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid',
      [ids, tenantId],
    )
  }

  async getRelationships(entityId: string, tenantId: TenantId, relType?: string): Promise<Relationship[]> {
    let sql = `SELECT id, tenant_id AS "tenantId", from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId", metadata
               FROM relationships WHERE (from_entity_id = $1::uuid OR to_entity_id = $1::uuid) AND tenant_id = $2::uuid`
    const params: unknown[] = [entityId, tenantId]
    if (relType) {
      sql += ' AND rel_type = $3'
      params.push(relType)
    }
    return this.query<Relationship>(sql, params)
  }

  async search(query: string, tenantId: TenantId, topK: number): Promise<KBEntry[]> {
    if (this.embedder) {
      try {
        const vecs = await this.embedder.embed([query])
        const vec = vecs[0]
        if (vec && vec.length > 0) {
          const vectorLiteral = `[${vec.join(',')}]`
          const rows = await this.query<{
            id: string; content: string; fetched_at: Date
            ttl_seconds: number; freshness_score: number; source: string
          }>(
            `SELECT id, content, fetched_at, ttl_seconds, freshness_score, source
             FROM kb_entries
             WHERE tenant_id = $1::uuid
             ORDER BY embedding <=> $2::vector
             LIMIT $3`,
            [tenantId, vectorLiteral, topK],
          ).catch(() => [])
          return rows.map(r => ({
            id: r.id,
            tenantId: tenantId as string,
            source: r.source,
            fetchedAt: r.fetched_at,
            ttlSeconds: r.ttl_seconds,
            freshnessScore: r.freshness_score,
            content: r.content,
          }))
        }
      } catch { /* fall through to ILIKE */ }
    }
    // Fallback: ILIKE on kb_episodes
    const rows = await this.query<{ text: string; created_at: Date }>(
      `SELECT text, created_at FROM kb_episodes
       WHERE tenant_id = $1::uuid AND text ILIKE $2
       ORDER BY created_at DESC LIMIT $3`,
      [tenantId, `%${query}%`, topK],
    ).catch(() => [])
    return rows.map(r => ({
      id: '',
      tenantId: tenantId as string,
      source: 'kb_episodes',
      fetchedAt: r.created_at,
      ttlSeconds: 86400,
      freshnessScore: 1.0,
      content: r.text,
    }))
  }

  async resolveContext(entityId: string, tenantId: TenantId, depth = 3): Promise<AgentContext> {
    const entity = await this.getEntity(entityId, tenantId)
    if (!entity) throw new Error(`Entity ${entityId} not found`)

    interface EntityRow { id: string; name: string; type: string; metadata: Record<string, unknown> }
    interface RelRow { from_entity_id: string; rel_type: string; to_entity_id: string }

    const [entityRows, relRows] = await Promise.all([
      this.query<EntityRow>(`
        WITH RECURSIVE entity_graph AS (
          SELECT e.id, e.name, e.type, e.metadata, 0 AS depth
          FROM entities e WHERE e.id = $1::uuid AND e.tenant_id = $2::uuid
          UNION ALL
          SELECT e2.id, e2.name, e2.type, e2.metadata, eg.depth + 1
          FROM entity_graph eg
          JOIN relationships r ON (r.from_entity_id = eg.id OR r.to_entity_id = eg.id)
          JOIN entities e2 ON e2.id = CASE
            WHEN r.from_entity_id = eg.id THEN r.to_entity_id ELSE r.from_entity_id END
          WHERE eg.depth < $3::int AND e2.tenant_id = $2::uuid
        )
        SELECT DISTINCT id, name, type, metadata FROM entity_graph LIMIT 20
      `, [entityId, tenantId, depth]),
      this.query<RelRow>(`
        SELECT from_entity_id, rel_type, to_entity_id FROM relationships
        WHERE (from_entity_id = $1::uuid OR to_entity_id = $1::uuid) AND tenant_id = $2::uuid LIMIT 30
      `, [entityId, tenantId]),
    ])

    const relatedEntitiesMap = new Map<string, Entity>()
    for (const row of entityRows) {
      if (row.id !== entityId) {
        relatedEntitiesMap.set(row.id, {
          id: row.id, tenantId, name: row.name, type: row.type, metadata: row.metadata,
        })
      }
    }
    const allRelationships: Relationship[] = relRows.map(r => ({
      id: '', tenantId, fromEntityId: r.from_entity_id, relType: r.rel_type, toEntityId: r.to_entity_id, metadata: {},
    }))

    // Extract connectorCoordinates from entity metadata
    const connectorCoordinates: Record<string, ConnectorCoordinates> = {}
    const allEntities = [entity, ...relatedEntitiesMap.values()]
    for (const e of allEntities) {
      const coords = (e.metadata as Record<string, unknown>)?.['connectorCoordinates']
      if (coords && typeof coords === 'object') {
        for (const [k, v] of Object.entries(coords as Record<string, unknown>)) {
          if (!connectorCoordinates[k] && typeof v === 'object' && v !== null) {
            connectorCoordinates[k] = v as unknown as ConnectorCoordinates
          }
        }
      }
    }

    // Compute real freshness from kb_entries
    const freshRows = await this.query<{ fs: number }>(
      `SELECT freshness_score AS fs FROM kb_entries WHERE tenant_id = $1::uuid AND content ILIKE $2 ORDER BY freshness_score ASC LIMIT 1`,
      [tenantId, `%${entity.name}%`],
    ).catch(() => [])
    const freshness = freshRows.length > 0 ? freshRows[0]!.fs : 1.0

    return {
      primaryEntity: entity,
      relatedEntities: [...relatedEntitiesMap.values()],
      relationships: allRelationships,
      recentEpisodes: await this.getRecentEpisodesForEntity(entity.name, tenantId),
      connectorCoordinates,
      groundingSources: this.buildGroundingSources(connectorCoordinates),
      freshness,
    }
  }

  private async getRecentEpisodesForEntity(entityName: string, tenantId: TenantId): Promise<Episode[]> {
    const rows = await this.query<{ text: string; created_at: Date }>(
      `SELECT text, created_at FROM kb_episodes
       WHERE tenant_id = $1::uuid
         AND created_at >= NOW() - INTERVAL '24 hours'
         AND text ILIKE '%' || $2 || '%'
       ORDER BY created_at DESC LIMIT 20`,
      [tenantId, entityName],
    ).catch(() => [])
    return rows.map(r => ({ text: r.text, source: 'kb_episodes', timestamp: new Date(r.created_at) }))
  }

  private buildGroundingSources(coords: Record<string, ConnectorCoordinates>): GroundingSource[] {
    const TTL_BY_CONNECTOR: Record<string, number> = {
      datadog: 60, prometheus: 60, k8s: 30, github: 120,
      argocd: 60, linear: 300, pagerduty: 120,
    }
    return Object.entries(coords).map(([connType, coord]) => ({
      source: connType,
      fetchedAt: coord.resolvedAt instanceof Date ? coord.resolvedAt : new Date(),
      ttl: TTL_BY_CONNECTOR[connType] ?? 300,
      confidence: typeof coord.confidence === 'number' ? coord.confidence : 1.0,
    }))
  }

  async upsertEntity(entity: EntitySpec, tenantId: TenantId): Promise<string> {
    // Merge metadata (jsonb ||) instead of a full replace — confirmed live
    // via independent review: SET metadata = EXCLUDED.metadata wiped
    // unrelated existing fields on every upsert of the same entity. Real
    // case found: a deploy_completed event's metadata ({sha, env, status})
    // was overwriting a prior deploy_trigger event's richer metadata
    // (imageUri, triggeredBy, workflowRun, commitMessage) on the same Deploy
    // entity, instead of the two events' facts accumulating on one record
    // as GraphBuilder's event-driven upsert model requires.
    const rows = await this.query<{ id: string }>(
      `INSERT INTO entities (tenant_id, type, name, metadata)
       VALUES ($1::uuid, $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, type, name) DO UPDATE
         SET metadata = entities.metadata || EXCLUDED.metadata
       RETURNING id`,
      [tenantId, entity.type, entity.name, JSON.stringify(entity.metadata ?? {})],
    )
    return rows[0]!.id
  }

  async upsertRelationship(rel: RelationshipSpec, tenantId: TenantId): Promise<string> {
    // Same merge-not-replace fix as upsertEntity above.
    const rows = await this.query<{ id: string }>(
      `INSERT INTO relationships (tenant_id, from_entity_id, rel_type, to_entity_id, metadata)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb)
       ON CONFLICT (tenant_id, from_entity_id, rel_type, to_entity_id)
	       DO UPDATE SET metadata = relationships.metadata || EXCLUDED.metadata
       RETURNING id`,
      [tenantId, rel.fromEntityId, rel.relType, rel.toEntityId, JSON.stringify(rel.metadata ?? {})],
    )
    if (!rows[0]?.id) throw new Error('upsertRelationship: no row returned')
    return rows[0]!.id
  }

  async deleteEntitiesByOrgPrefix(type: string, orgPrefix: string, keepNames: string[], tenantId: TenantId): Promise<number> {
    if (keepNames.length === 0) return 0
    const placeholders = keepNames.map((_, i) => `$${i + 4}`).join(', ')
    const rows = await this.query<{ id: string }>(
      `DELETE FROM entities WHERE tenant_id = $1::uuid AND type = $2 AND name LIKE $3 AND name != ALL(ARRAY[${placeholders}]) RETURNING id`,
      [tenantId, type, `${orgPrefix}/%`, ...keepNames],
    ).catch(() => [])
    return rows.length
  }

  async markConnectorEntitiesStale(connectorType: string, tenantId: TenantId): Promise<number> {
    const now = new Date().toISOString()
    const rows = await this.query<{ id: string }>(
      `UPDATE entities
       SET metadata = metadata || $3::jsonb
       WHERE tenant_id = $1::uuid
         AND metadata->'connectorCoordinates' ? $2
       RETURNING id`,
      [tenantId, connectorType, JSON.stringify({ stale: true, staleAt: now, staleSince: connectorType })],
    ).catch(() => [])
    return rows.length
  }

  async resolveContextByName(name: string, tenantId: TenantId, depth = 2): Promise<AgentContext | null> {
    // Defense in depth: empty/whitespace input would match every row via ILIKE '%%'
    if (!name || name.trim().length === 0) return null
    // Two real bugs here, confirmed live via independent review — this is
    // the front door for every graph-first lookup in the system, so both
    // mattered a lot:
    // 1. `metadata->>'confidence' DESC` sorts the *text* representation of
    //    the JSON value, not a number, and Postgres's DESC default is
    //    NULLS FIRST — so any entity with no confidence metadata at all
    //    (never scored) sorted ABOVE every entity that had a real score.
    //    Cast to numeric and push nulls to the bottom explicitly.
    // 2. A bare ILIKE '%name%' substring match with no preference for an
    //    exact match meant a query for e.g. "api" could resolve to an
    //    unrelated entity that merely contains "api" as a substring, ahead
    //    of the entity actually named exactly that. Rank exact
    //    (case-insensitive) matches first.
    const rows = await this.query<{ id: string }>(
      `SELECT id FROM entities WHERE tenant_id = $1::uuid AND name ILIKE $2
       ORDER BY (LOWER(name) = LOWER($3)) DESC, COALESCE((metadata->>'confidence')::numeric, 0) DESC
       LIMIT 1`,
      [tenantId, `%${name}%`, name],
    )
    if (rows.length === 0) return null
    return this.resolveContext(rows[0]!.id, tenantId, depth)
  }

  async getEntityByExternalRef(externalId: string, tenantId: TenantId): Promise<string | null> {
    const rows = await this.query<{ id: string }>(
      `SELECT id FROM entities WHERE tenant_id = $1::uuid AND metadata->>'externalId' = $2 LIMIT 1`,
      [tenantId, externalId],
    )
    return rows[0]?.id ?? null
  }

  // Same `metadata->'connectorCoordinates' ? $2` containment check already
  // used by markConnectorEntitiesStale — every entity a given connector
  // type's bootstrap touched.
  async getEntitiesByConnectorType(connectorType: string, tenantId: TenantId): Promise<Entity[]> {
    return this.query<Entity>(
      `SELECT id, tenant_id AS "tenantId", type, name, metadata FROM entities
       WHERE tenant_id = $1::uuid AND metadata->'connectorCoordinates' ? $2`,
      [tenantId, connectorType],
    )
  }
}
