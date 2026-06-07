import type { TenantId } from '@anvay/types'
import type { IModelProvider, Message } from '../interfaces/provider.js'
import type { IKnowledgeGraph } from '../interfaces/knowledge-graph.js'
import type { GraphEvent } from './events.js'

/** Cheap-model service name extraction. Returns null if no service found. */
const EXTRACT_PROMPT =
  'Extract the primary service or software component name from this text. ' +
  'Respond with ONLY the name (max 3 words), or empty string if none found.\n\n' +
  'Text: '

export class GraphBuilderAgent {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly model: IModelProvider,
    private readonly cheapModel: string,
  ) {}

  /** Route event to correct handler. Never throws — failures are caught and logged. */
  async handle(event: GraphEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'connector_registered':
          return await this.onConnectorRegistered(event)
        case 'pr_merged':
          return await this.onPrMerged(event)
        case 'incident_created':
          return await this.onIncidentCreated(event)
        case 'deploy_completed':
          return await this.onDeployCompleted(event)
        case 'ticket_created':
          return await this.onTicketCreated(event)
      }
    } catch (err) {
      // Log + swallow — graph builder errors must not break the event pipeline
      console.error('[GraphBuilderAgent] event handling failed:', err instanceof Error ? err.message : err)
    }
  }

  private tid(tenantId: string): TenantId {
    return tenantId as TenantId
  }

  // -- event handlers --------------------------------------------------------

  private async onConnectorRegistered(event: GraphEvent & { type: 'connector_registered' }): Promise<void> {
    await this.kg.upsertEntity(
      {
        type: 'Connector',
        name: event.connectorId,
        metadata: { connectorType: event.connectorType, payload: event.payload },
      },
      this.tid(event.tenantId),
    )
  }

  private async onPrMerged(event: GraphEvent & { type: 'pr_merged' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)

    // Upsert Repo
    const repoId = await this.kg.upsertEntity(
      { type: 'Repo', name: event.repo, metadata: { defaultBranch: event.branch } },
      tenantId,
    )

    // Extract service name from PR message (cheap model, best-effort)
    let serviceName: string | null = null
    try {
      serviceName = await this.extractServiceName(event.message, tenantId)
    } catch {
      // Best-effort — proceed without service resolution
    }

    if (serviceName) {
      // Upsert Service + HOSTED_IN relationship
      const serviceId = await this.kg.upsertEntity(
        { type: 'Service', name: serviceName },
        tenantId,
      )
      await this.kg.upsertRelationship(
        { fromEntityId: serviceId, relType: 'HOSTED_IN', toEntityId: repoId },
        tenantId,
      )
    }

    // Upsert Engineer (committer)
    await this.kg.upsertEntity(
      { type: 'Engineer', name: event.author },
      tenantId,
    )

    // Upsert Commit
    const commitId = await this.kg.upsertEntity(
      { type: 'Commit', name: event.sha.slice(0, 7), metadata: { sha: event.sha, message: event.message, branch: event.branch } },
      tenantId,
    )
    await this.kg.upsertRelationship(
      { fromEntityId: commitId, relType: 'INTRODUCED_BY', toEntityId: repoId },
      tenantId,
    )
  }

  private async onDeployCompleted(event: GraphEvent & { type: 'deploy_completed' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)

    // Upsert Service
    const serviceId = await this.kg.upsertEntity(
      { type: 'Service', name: event.service },
      tenantId,
    )

    // Upsert Deploy entity
    const deployId = await this.kg.upsertEntity(
      {
        type: 'Deploy',
        name: `${event.service}-${event.sha.slice(0, 7)}`,
        metadata: { sha: event.sha, env: event.env, status: event.status },
      },
      tenantId,
    )

    // Deploy → DEPLOYED_TO → Service
    await this.kg.upsertRelationship(
      { fromEntityId: deployId, relType: 'DEPLOYED_TO', toEntityId: serviceId },
      tenantId,
    )
  }

  private async onIncidentCreated(event: GraphEvent & { type: 'incident_created' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)

    // Upsert Incident
    const incidentId = await this.kg.upsertEntity(
      {
        type: 'Incident',
        name: event.incidentId,
        metadata: { title: event.title, severity: event.severity },
      },
      tenantId,
    )

    // If service hint present, create AFFECTS relationship
    if (event.serviceHint) {
      const serviceId = await this.kg.upsertEntity(
        { type: 'Service', name: event.serviceHint },
        tenantId,
      )
      await this.kg.upsertRelationship(
        { fromEntityId: incidentId, relType: 'AFFECTS', toEntityId: serviceId },
        tenantId,
      )
    }
  }

  private async onTicketCreated(event: GraphEvent & { type: 'ticket_created' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)

    // Upsert Ticket entity
    const ticketId = await this.kg.upsertEntity(
      {
        type: 'Ticket',
        name: event.ticketId,
        metadata: { title: event.title, description: event.description, labels: event.labels },
      },
      tenantId,
    )

    // Extract service name from title + description (cheap model)
    let serviceName: string | null = null
    try {
      serviceName = await this.extractServiceName(`${event.title} ${event.description}`, tenantId)
    } catch {
      // Best-effort — proceed without service resolution
    }

    if (serviceName) {
      const serviceId = await this.kg.upsertEntity(
        { type: 'Service', name: serviceName },
        tenantId,
      )
      await this.kg.upsertRelationship(
        {
          fromEntityId: ticketId,
          relType: 'RELATES_TO',
          toEntityId: serviceId,
          metadata: { confidence: 0.7 },
        },
        tenantId,
      )
    }
  }

  // -- helpers ---------------------------------------------------------------

  /**
   * Extracts a service/component name from free text using the cheap model.
   * Returns null if no service found or model call fails.
   */
  async extractServiceName(text: string, _tenantId: TenantId): Promise<string | null> {
    const messages: Message[] = [
      { role: 'system', content: EXTRACT_PROMPT + text.slice(0, 500) },
      { role: 'user', content: text.slice(0, 500) },
    ]
    const resp = await this.model.chat(messages, [], {
      model: this.cheapModel,
      maxTokens: 30,
      temperature: 0,
    })
    const name = resp.content.trim()
    return name.length > 0 ? name : null
  }
}
