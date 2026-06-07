import type { TenantId } from '@anvay/types'

export interface Entity {
  id: string
  tenantId: string
  type: string
  name: string
  metadata: Record<string, unknown>
}

export interface Relationship {
  id: string
  tenantId: string
  fromEntityId: string
  relType: string
  toEntityId: string
  metadata: Record<string, unknown>
}

export interface KBEntry {
  id: string
  tenantId: string
  entityId?: string
  source: string
  fetchedAt: Date
  ttlSeconds: number
  freshnessScore: number
  content: string
}

export interface Episode {
  text: string
  source: string
  timestamp: Date
}

export interface Fact {
  claim: string
  source: string
  validFrom: Date
  validTo?: Date
}

export interface ConnectorCoordinates {
  connectorType: string
  resourceIds: Record<string, string>
  resolvedAt: Date
  confidence: number
}

export interface AgentContext {
  primaryEntity: Entity
  relatedEntities: Entity[]
  relationships: Relationship[]
  recentEpisodes: Episode[]
  connectorCoordinates: Record<string, ConnectorCoordinates>
  groundingSources: GroundingSource[]
  freshness: number
}

export interface GroundingSource {
  source: string
  fetchedAt: Date
  ttl: number
  confidence: number
}

export interface EntitySpec {
  id?: string
  type: string
  name: string
  metadata?: Record<string, unknown>
}

export interface RelationshipSpec {
  fromEntityId: string
  relType: string
  toEntityId: string
  metadata?: Record<string, unknown>
}

export interface GraphSeed {
  entities: EntitySpec[]
  relationships: RelationshipSpec[]
  episodeHints: string[]
}

export interface IKnowledgeGraph {
  addEpisode(episode: Episode): Promise<void>
  getFacts(query: string, at?: Date): Promise<Fact[]>
  getEntity(id: string, tenantId: TenantId): Promise<Entity | null>
  getRelationships(entityId: string, tenantId: TenantId, relType?: string): Promise<Relationship[]>
  search(query: string, tenantId: TenantId, topK: number): Promise<KBEntry[]>
  resolveContext(entityId: string, tenantId: TenantId, depth?: number): Promise<AgentContext>
  upsertEntity(entity: EntitySpec, tenantId: TenantId): Promise<string>
  upsertRelationship(rel: RelationshipSpec, tenantId: TenantId): Promise<string>
}
