import type { TenantId } from '@anvay/types'
import type { IKnowledgeGraph, Entity, Relationship, KBEntry, Episode, Fact, AgentContext, EntitySpec, RelationshipSpec } from '../interfaces/knowledge-graph.js'
import { StructuralGraph } from './structural-graph.js'
import { GraphitiClient } from './graphiti-client.js'

/**
 * Combines StructuralGraph (Postgres — entities/relationships) with
 * GraphitiClient (Python agent-service — episodic layer via Graphiti).
 *
 * This is the IKnowledgeGraph implementation for production use.
 * Falls back to structural-only when agent-service is unavailable.
 */
export class HybridKnowledgeGraph implements IKnowledgeGraph {
  constructor(
    private readonly structural: StructuralGraph,
    private readonly graphiti?: GraphitiClient,
  ) {}

  async addEpisode(episode: Episode): Promise<void> {
    if (this.graphiti) return this.graphiti.addEpisode(episode)
    return this.structural.addEpisode(episode)
  }

  async getFacts(query: string, tenantId?: string, at?: Date): Promise<Fact[]> {
    if (this.graphiti) return this.graphiti.getFacts(query, tenantId, at)
    return this.structural.getFacts(query, tenantId, at)
  }

  // Structural delegates
  getEntity(id: string, tenantId: TenantId): Promise<Entity | null> {
    return this.structural.getEntity(id, tenantId)
  }
  getRelationships(entityId: string, tenantId: TenantId, relType?: string): Promise<Relationship[]> {
    return this.structural.getRelationships(entityId, tenantId, relType)
  }
  resolveContext(entityId: string, tenantId: TenantId, depth?: number): Promise<AgentContext> {
    return this.structural.resolveContext(entityId, tenantId, depth)
  }
  resolveContextByName(name: string, tenantId: TenantId, depth?: number): Promise<AgentContext | null> {
    return this.structural.resolveContextByName(name, tenantId, depth)
  }
  markConnectorEntitiesStale(connectorType: string, tenantId: TenantId): Promise<number> {
    return this.structural.markConnectorEntitiesStale(connectorType, tenantId)
  }
  upsertEntity(entity: EntitySpec, tenantId: TenantId): Promise<string> {
    return this.structural.upsertEntity(entity, tenantId)
  }
  upsertRelationship(rel: RelationshipSpec, tenantId: TenantId): Promise<string> {
    return this.structural.upsertRelationship(rel, tenantId)
  }
  getEntityByExternalRef(externalId: string, tenantId: TenantId): Promise<string | null> {
    return this.structural.getEntityByExternalRef(externalId, tenantId)
  }

  async search(query: string, tenantId: TenantId, topK: number): Promise<KBEntry[]> {
    if (this.graphiti) {
      const facts = await this.graphiti.getFacts(query)
      return facts.slice(0, topK).map(f => ({
        id: '',
        tenantId,
        source: 'graphiti',
        fetchedAt: new Date(),
        ttlSeconds: 3600,
        freshnessScore: 1.0,
        content: f.claim,
      }))
    }
    return []
  }
}
