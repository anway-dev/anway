import type { IKnowledgeGraph, EntitySpec, RelationshipSpec } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

interface ConnectorBootstrapPayload {
  connectorId: string
  tenantId: string
  type: string
  config: Record<string, unknown>
}

interface TicketCreatedPayload {
  ticketId: string
  tenantId: string
  title: string
  description: string
  labels?: string[]
  teamId?: string
}

interface PrMergedPayload {
  repo: string
  tenantId: string
  prNumber: number
  commitSha: string
  commitMessage: string
  author: string
}

/**
 * Graph Builder Agent — event-driven entity extraction and graph maintenance.
 * Runs on connector lifecycle events. Never called by users.
 */
export class GraphBuilderAgent {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async handleConnectorRegistered(payload: ConnectorBootstrapPayload): Promise<void> {
    const { connectorId, tenantId, type } = payload
    const tenant = tenantId as TenantId

    const connectorEntity: EntitySpec = {
      type: 'Connector',
      name: connectorId,
      metadata: { connectorType: type },
    }
    await this.kg.upsertEntity(connectorEntity, tenant)
  }

  async handleTicketCreated(payload: TicketCreatedPayload): Promise<void> {
    const { ticketId, tenantId, title, description, labels } = payload
    const tenant = tenantId as TenantId

    const ticketEntity: EntitySpec = {
      id: ticketId,
      type: 'Ticket',
      name: title,
      metadata: { description, labels, source: 'linear' },
    }
    await this.kg.upsertEntity(ticketEntity, tenant)

    // If labels contain a service name, try resolving it
    const serviceName = this.extractServiceName(title, description, labels)
    if (serviceName) {
      const serviceEntity: EntitySpec = {
        type: 'Service',
        name: serviceName,
      }
      const serviceId = await this.kg.upsertEntity(serviceEntity, tenant)
      if (serviceId) {
        await this.kg.upsertRelationship({
          fromEntityId: ticketId,
          relType: 'RELATES_TO',
          toEntityId: serviceId,
          metadata: { confidence: 0.7 },
        }, tenant)
      }
    }
  }

  async handlePrMerged(payload: PrMergedPayload): Promise<void> {
    const { repo, tenantId, commitSha, commitMessage, author } = payload
    const tenant = tenantId as TenantId

    const commitEntity: EntitySpec = {
      type: 'Commit',
      name: commitSha.slice(0, 7),
      metadata: { repo, author, message: commitMessage },
    }
    const commitId = await this.kg.upsertEntity(commitEntity, tenant)

    // Parse "fixes #N" or "closes #N" from commit message
    const ticketMatch = commitMessage.match(/(?:fixes|closes|resolves)\s+#(\d+)/i)
    if (ticketMatch && commitId) {
      await this.kg.upsertRelationship({
        fromEntityId: commitId,
        relType: 'FIXES',
        toEntityId: ticketMatch[1]!,
        metadata: { confidence: 0.9 },
      }, tenant)
    }
  }

  private extractServiceName(title: string, _description: string, labels?: string[]): string | null {
    // Try labels first
    if (labels) {
      for (const label of labels) {
        if (label.includes('service:') || label.includes('svc:')) {
          return label.split(':')[1]?.trim() ?? null
        }
      }
    }
    // Fall back: simple name extraction from title
    const match = title.match(/\b([a-z]+-[a-z]+-api)\b/i)
    return match?.[1]?.toLowerCase() ?? null
  }
}
