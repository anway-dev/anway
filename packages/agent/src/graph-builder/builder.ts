import type { TenantId } from '@anvay/types'
import type { IModelProvider, Message } from '../interfaces/provider.js'
import type { IKnowledgeGraph } from '../interfaces/knowledge-graph.js'
import type { GraphEvent } from './events.js'
import type { IConnectorBootstrap } from './bootstrap.js'

export interface GraphBuilderLogger {
  error(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
}

/** Cheap-model service name extraction. Returns null if no service found. */
const EXTRACT_PROMPT =
  'Extract the primary service or software component name from this text. ' +
  'Respond with ONLY the name (max 3 words), or empty string if none found.\n\n' +
  'Text: '

export class GraphBuilderAgent {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly model: IModelProvider,
    private readonly logger?: GraphBuilderLogger,
    private readonly bootstrapRegistry?: Map<string, IConnectorBootstrap>,
    private readonly redisPublisher?: { publish(channel: string, message: string): Promise<number> },
  ) {}

  /**
   * Route event to correct handler. Failures are caught and logged so graph
   * builder errors never break the event pipeline — EXCEPT bootstrap failures
   * on connector lifecycle events, which rethrow so callers can record an
   * error status instead of a false success.
   */
  async handle(event: GraphEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'connector_registered':
          await this.onConnectorRegistered(event); break
        case 'pr_merged':
          await this.onPrMerged(event); break
        case 'incident_created':
          await this.onIncidentCreated(event); break
        case 'deploy_completed':
          await this.onDeployCompleted(event); break
        case 'ticket_created':
          await this.onTicketCreated(event); break
        case 'connector_removed':
          await this.onConnectorRemoved(event); break
        case 'connector_reconnected':
          await this.onConnectorReconnected(event as GraphEvent & { type: 'connector_reconnected' }); break
      }
      // Emit graph:updated after successful handling
      await this.redisPublisher?.publish('graph:updated', JSON.stringify({
        eventType: event.type,
        tenantId: (event as GraphEvent & { tenantId: string }).tenantId,
        processedAt: new Date().toISOString(),
      }))
    } catch (err) {
      this.logger?.error({ err, eventType: event.type }, 'GraphBuilderAgent event handling failed')
      if (event.type === 'connector_registered' || event.type === 'connector_reconnected') throw err
    }
  }

  private tid(tenantId: string): TenantId {
    return tenantId as TenantId
  }

  // -- event handlers --------------------------------------------------------

  private async onConnectorRegistered(event: GraphEvent & { type: 'connector_registered' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)
    await this.kg.upsertEntity(
      {
        type: 'Connector',
        name: event.connectorId,
        metadata: { connectorType: event.connectorType, payload: event.payload },
      },
      tenantId,
    )

    // If a bootstrap is registered for this connector type, run it
    const bootstrap = this.bootstrapRegistry?.get(event.connectorType)
    if (bootstrap) {
      try {
        const result = await bootstrap.bootstrap(tenantId, event.connectorId, event.payload)
        if (result.entitiesUpserted > 0) {
          this.logger?.warn(
            { entitiesUpserted: result.entitiesUpserted, connectorType: event.connectorType },
            `GraphBuilder: bootstrapped ${result.entitiesUpserted} entities from ${event.connectorType}`,
          )
        }
      } catch (err) {
        this.logger?.error({ err, connectorType: event.connectorType }, 'GraphBuilder: bootstrap failed')
        throw err
      }
    }
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

    let serviceName = event.serviceHint ?? null

    // If no explicit serviceHint, try LLM extraction from title
    if (!serviceName) {
      try {
        serviceName = await this.extractServiceName(event.title, tenantId)
      } catch {
        // Best-effort — proceed without service resolution
      }
    }

    if (serviceName) {
      const serviceId = await this.kg.upsertEntity(
        { type: 'Service', name: serviceName },
        tenantId,
      )
      const confidence = event.serviceHint ? 1.0 : this.scoreServiceMatch(serviceName, event.title)
      await this.kg.upsertRelationship(
        {
          fromEntityId: incidentId,
          relType: 'AFFECTS',
          toEntityId: serviceId,
          metadata: { confidence, unconfirmed: confidence < 0.7 },
        },
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
    const sourceText = `${event.title} ${event.description}`
    let serviceName: string | null = null
    try {
      serviceName = await this.extractServiceName(sourceText, tenantId)
    } catch {
      // Best-effort — proceed without service resolution
    }

    if (serviceName) {
      const serviceId = await this.kg.upsertEntity(
        { type: 'Service', name: serviceName },
        tenantId,
      )
      const confidence = this.scoreServiceMatch(serviceName, sourceText)
      await this.kg.upsertRelationship(
        {
          fromEntityId: ticketId,
          relType: 'RELATES_TO',
          toEntityId: serviceId,
          metadata: { confidence, unconfirmed: confidence < 0.7 },
        },
        tenantId,
      )
    }
  }

  private async onConnectorRemoved(event: GraphEvent & { type: 'connector_removed' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)
    const n = await this.kg.markConnectorEntitiesStale(event.connectorType, tenantId)
    await this.kg.addEpisode({
      text: `Connector ${event.connectorType} removed — ${n} entities marked stale`,
      source: 'graph-builder',
      timestamp: new Date(),
    }).catch(() => {})
  }

  private async onConnectorReconnected(event: GraphEvent & { type: 'connector_reconnected' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)
    const bootstrap = this.bootstrapRegistry?.get(event.connectorType)
    if (!bootstrap) {
      await this.kg.addEpisode({
        text: `Connector reconnected: ${event.connectorType} (no bootstrapper)`,
        source: 'graph-builder',
        timestamp: new Date(),
      }).catch(() => {})
      return
    }
    const result = await bootstrap.bootstrap(tenantId, event.connectorId, event.payload)
    await this.kg.addEpisode({
      text: `Connector reconnected and re-bootstrapped: ${event.connectorType}. ${result.episodeHints.join('. ')}`,
      source: 'graph-builder',
      timestamp: new Date(),
    }).catch(() => {})
  }

  // -- helpers ---------------------------------------------------------------

  /**
   * Scores how confidently an extracted service name relates to its source text.
   * Verbatim mention (name appears as a substring, case-insensitive) → 0.9.
   * Model-inferred only (name not present in text) → 0.6.
   * Callers store confidence < 0.7 with `unconfirmed: true` (per KB confidence policy).
   */
  private scoreServiceMatch(name: string, sourceText: string): number {
    return sourceText.toLowerCase().includes(name.toLowerCase()) ? 0.9 : 0.6
  }

  /**
   * Extracts a service/component name from free text using the cheap model.
   * Returns null if no service found or model call fails.
   */
  async extractServiceName(text: string, _tenantId: TenantId): Promise<string | null> {
    // Send text once as user content — avoid token doubling in high-volume cheap-model calls
    const messages: Message[] = [
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: text.slice(0, 500) },
    ]
    const resp = await this.model.chat(messages, [], {
      model: this.model.cheapModelId,
      maxTokens: 30,
      temperature: 0,
    })
    const name = resp.content.trim()
    return name.length > 0 ? name : null
  }
}
