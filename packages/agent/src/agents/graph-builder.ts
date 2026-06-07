import type { IKnowledgeGraph, EntitySpec } from '../interfaces/knowledge-graph.js'
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
      type: 'Ticket',
      name: title,
      metadata: { externalId: ticketId, description, labels, source: 'linear' },
    }
    const dbTicketId = await this.kg.upsertEntity(ticketEntity, tenant)

    const serviceName = this.extractServiceName(title, description, labels)
    if (serviceName && dbTicketId) {
      const serviceId = await this.kg.upsertEntity({ type: 'Service', name: serviceName }, tenant)
      if (serviceId) {
        await this.kg.upsertRelationship(
          { fromEntityId: dbTicketId, relType: 'RELATES_TO', toEntityId: serviceId, metadata: { confidence: 0.7 } },
          tenant,
        )
      }
    }
  }

  async handlePrMerged(payload: PrMergedPayload): Promise<void> {
    const { repo, tenantId, commitSha, commitMessage, author } = payload
    const tenant = tenantId as TenantId

    const commitId = await this.kg.upsertEntity(
      { type: 'Commit', name: commitSha.slice(0, 7), metadata: { repo, author, message: commitMessage } },
      tenant,
    )

    const ticketMatch = commitMessage.match(/(?:fixes|closes|resolves)\s+#(\d+)/i)
    if (ticketMatch && commitId) {
      const ticketEntityId = await this.kg.getEntityByExternalRef(ticketMatch[1]!, tenant)
      if (ticketEntityId) {
        await this.kg.upsertRelationship(
          { fromEntityId: commitId, relType: 'FIXES', toEntityId: ticketEntityId, metadata: { confidence: 0.9 } },
          tenant,
        )
      }
    }
  }

  private extractServiceName(title: string, _description: string, labels?: string[]): string | null {
    if (labels) {
      for (const label of labels) {
        if (label.includes('service:') || label.includes('svc:')) {
          return label.split(':')[1]?.trim() ?? null
        }
      }
    }
    const match = title.match(/\b([a-z]+-[a-z]+-api)\b/i)
    return match?.[1]?.toLowerCase() ?? null
  }
}
