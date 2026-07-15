import type { TenantId } from '@anway/types'
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
  'You extract the primary service or software-component name that is EXPLICITLY named in the text. ' +
  'Respond with ONLY that exact name (max 3 words) when one is explicitly named; otherwise respond with an empty string. ' +
  'Do NOT invent, guess, infer, or generalise a name. If the text only describes a vague problem ' +
  '(e.g. "the site is slow", "users are complaining", "errors this morning") WITHOUT naming a specific service, ' +
  'return an empty string. Never answer with a generic placeholder such as "web server", "server", "frontend", ' +
  '"backend", "the app", "website", or "database" unless that exact word is the named service.\n\n' +
  'Examples:\n' +
  '"Checkout failing on payments-api since 14:30" -> payments-api\n' +
  '"auth-service throwing 401s after the rollout" -> auth-service\n' +
  '"the whole site feels slow this morning" -> \n' +
  '"a few users are complaining about errors" -> '

// GitHub's standard issue-closing keywords (case-insensitive). Matches the
// CLAUDE.md-documented trigger: "pr_merged → ... extract 'fixes #N' →
// Commit→FIXES→Ticket" — previously never implemented at all.
const FIXES_RE = /\b(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\s+#(\d+)/gi

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
        case 'alert_fired':
          await this.onAlertFired(event); break
        case 'deploy_completed':
          await this.onDeployCompleted(event); break
        case 'deploy_trigger':
          await this.onDeployTrigger(event); break
        case 'ticket_created':
          await this.onTicketCreated(event); break
        case 'connector_removed':
          await this.onConnectorRemoved(event); break
        case 'connector_reconnected':
          await this.onConnectorReconnected(event as GraphEvent & { type: 'connector_reconnected' }); break
        // T17 — missing lifecycle event handlers
        case 'project_created':
          await this.onProjectCreated(event as unknown as { type: 'project_created'; tenantId: string; projectId: string; name: string; teamId?: string }); break
        case 'repo_created':
          await this.onRepoCreated(event as unknown as { type: 'repo_created'; tenantId: string; repoId: string; name: string; language?: string; org?: string }); break
        case 'namespace_created':
          await this.onNamespaceCreated(event as unknown as { type: 'namespace_created'; tenantId: string; name: string; services?: string[] }); break
        case 'resource_added':
          await this.onResourceAdded(event as unknown as { type: 'resource_added'; tenantId: string; resourceId: string; resourceType: string; tags?: Record<string, string>; service?: string; team?: string }); break
        case 'team_changed':
          await this.onTeamChanged(event as unknown as { type: 'team_changed'; tenantId: string; teamId: string; name: string; members?: string[]; slackChannel?: string }); break
        case 'oncall_rotation':
          await this.onOncallRotation(event as unknown as { type: 'oncall_rotation'; tenantId: string; teamId: string; engineerId: string; engineerName?: string; validFrom: string; validTo?: string }); break
        case 'connector_capability_changed':
          await this.onConnectorCapabilityChanged(event as unknown as { type: 'connector_capability_changed'; tenantId: string; connectorId: string; connectorType: string }); break
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
    const connectorId = await this.kg.upsertEntity(
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
        // Write bootstrap episode hints to episodic layer (same pattern as onConnectorReconnected)
        await this.kg.addEpisode({
          text: `Connector registered and bootstrapped: ${event.connectorType}. ${result.episodeHints.join('. ')}`,
          source: 'graph-builder',
          timestamp: new Date(),
        }).catch(() => {})
        await this.linkConnectorProvides(connectorId, event.connectorType, tenantId)
      } catch (err) {
        this.logger?.error({ err, connectorType: event.connectorType }, 'GraphBuilder: bootstrap failed')
        throw err
      }
    }
  }

  // (Connector)-[:PROVIDES]->(Entity) — documented in CLAUDE.md's canonical
  // Structural Graph schema ("connector feeds data about this service") but
  // never created anywhere: ConnectorBootstrapResult only reports counts,
  // not the entity list, so nothing downstream of a bootstrap run knew which
  // real entities to link the Connector to. Resolved here via
  // getEntitiesByConnectorType — every entity whose metadata carries this
  // connector type's coordinates (set by the bootstrap's own upsertEntity
  // calls) gets a PROVIDES edge from the Connector entity. Best-effort: a
  // failure here must not fail the bootstrap that already succeeded.
  private async linkConnectorProvides(connectorId: string, connectorType: string, tenantId: TenantId): Promise<void> {
    try {
      const entities = await this.kg.getEntitiesByConnectorType(connectorType, tenantId)
      for (const entity of entities) {
        await this.kg.upsertRelationship(
          { fromEntityId: connectorId, relType: 'PROVIDES', toEntityId: entity.id },
          tenantId,
        )
      }
    } catch (err) {
      this.logger?.error({ err, connectorType }, 'GraphBuilder: linking Connector PROVIDES edges failed')
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

    // Commit -[:FIXES]-> Ticket — previously never parsed at all. Ticket
    // identity here is repo-scoped (`${repo}#${number}`) since a bare issue
    // number in commit text carries no connector-specific ticket ID. If a
    // richer Ticket entity already exists for the same issue via a separate
    // Jira/Linear/GitHub-issues sync (ticket_created), this creates a
    // second, repo-scoped Ticket record rather than resolving to it — a
    // disclosed limitation; true cross-connector ticket identity resolution
    // needs the ticket_created bootstrap's own external ID, not a bare
    // commit-message reference.
    const ticketNumbers = [...event.message.matchAll(FIXES_RE)].map(m => m[1])
    for (const num of ticketNumbers) {
      const ticketId = await this.kg.upsertEntity(
        { type: 'Ticket', name: `${event.repo}#${num}`, metadata: { source: 'commit-message-reference' } },
        tenantId,
      )
      await this.kg.upsertRelationship(
        { fromEntityId: commitId, relType: 'FIXES', toEntityId: ticketId },
        tenantId,
      )
    }
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

    // Deploy -[:INTRODUCED]-> Commit — documented in CLAUDE.md's canonical
    // relationship table but never created anywhere. Same (type, name)
    // upsert key as onPrMerged's Commit entity, so this resolves the same
    // Commit row if pr_merged already fired for this sha, or creates a
    // minimal placeholder Commit record if deploy events arrive standalone
    // (e.g. no GitHub connector wired, direct CI push).
    const commitId = await this.kg.upsertEntity(
      { type: 'Commit', name: event.sha.slice(0, 7), metadata: { sha: event.sha } },
      tenantId,
    )
    await this.kg.upsertRelationship(
      { fromEntityId: deployId, relType: 'INTRODUCED', toEntityId: commitId },
      tenantId,
    )
  }

  // Alert -[:TRIGGERED_BY]-> Incident — documented in CLAUDE.md's canonical
  // relationship table but had no GraphEvent type or handler at all.
  // Alertmanager webhooks publish both incident_created AND alert_fired
  // (apps/gateway/src/routes/events.ts); only incident_created was ever
  // subscribed to, so the Alert entity itself was never created.
  private async onAlertFired(event: GraphEvent & { type: 'alert_fired' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)

    const alertId = await this.kg.upsertEntity(
      {
        type: 'Alert',
        name: `alert-${event.incidentId}`,
        metadata: { title: event.title, severity: event.severity, service: event.service ?? null },
      },
      tenantId,
    )

    // Same (tenant_id, type, name) upsert key as onIncidentCreated — resolves
    // the same Incident row rather than creating a duplicate.
    const incidentId = await this.kg.upsertEntity(
      { type: 'Incident', name: event.incidentId, metadata: { title: event.title, severity: event.severity } },
      tenantId,
    )

    await this.kg.upsertRelationship(
      { fromEntityId: alertId, relType: 'TRIGGERED_BY', toEntityId: incidentId },
      tenantId,
    )
  }

  private async onDeployTrigger(event: GraphEvent & { type: 'deploy_trigger' }): Promise<void> {
    const tenantId = this.tid(event.tenantId)

    // Ensure Service entity exists
    const serviceId = await this.kg.upsertEntity(
      { type: 'Service', name: event.service },
      tenantId,
    )

    // Create pending Deploy entity — status transitions to 'success'/'failed' on deploy_completed
    await this.kg.upsertEntity(
      {
        type: 'Deploy',
        name: `${event.service}-${event.sha.slice(0, 7)}`,
        metadata: {
          sha: event.sha,
          imageUri: event.imageUri,
          env: event.environment,
          repo: event.repo,
          triggeredBy: event.triggeredBy,
          workflowRun: event.workflowRun,
          commitMessage: event.commitMessage,
          status: 'pending',
        },
      },
      tenantId,
    )

    // Resolve Repo entity (may already exist from GitHub bootstrap)
    const repoId = await this.kg.upsertEntity(
      { type: 'Repo', name: event.repo, metadata: {} },
      tenantId,
    )

    await this.kg.upsertRelationship(
      { fromEntityId: serviceId, relType: 'HOSTED_IN', toEntityId: repoId },
      tenantId,
    )

    await this.kg.addEpisode({
      text: `Deploy triggered for ${event.service} (${event.sha.slice(0, 7)}) to ${event.environment} by ${event.triggeredBy}. Image: ${event.imageUri}. ${event.commitMessage ?? ''}`,
      source: 'deploy-trigger',
      timestamp: new Date(),
    }).catch(() => {})

    // Publish to pipeline gate channel so the gateway can surface a gate in the UI
    await this.redisPublisher?.publish('deploy:gate_pending', JSON.stringify({
      tenantId: event.tenantId,
      service: event.service,
      sha: event.sha,
      imageUri: event.imageUri,
      environment: event.environment,
      triggeredBy: event.triggeredBy,
      workflowRun: event.workflowRun,
      commitMessage: event.commitMessage,
      triggeredAt: new Date().toISOString(),
    })).catch(() => {})
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
    // Same (type, name) upsert key as onConnectorRegistered — resolves the
    // same Connector entity row rather than creating a duplicate.
    const connectorId = await this.kg.upsertEntity(
      { type: 'Connector', name: event.connectorId, metadata: { connectorType: event.connectorType } },
      tenantId,
    )
    await this.linkConnectorProvides(connectorId, event.connectorType, tenantId)
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

  // -- T17: missing lifecycle event handlers ---------------------------------

  // -- T17: missing lifecycle event handlers ---------------------------------

  private async onProjectCreated(event: { tenantId: string; projectId: string; name: string; teamId?: string }): Promise<void> {
    const tid = this.tid(event.tenantId)
    await this.kg.upsertEntity({ type: 'Project', name: event.name, metadata: { projectId: event.projectId, teamId: event.teamId } }, tid)
  }

  private async onRepoCreated(event: { tenantId: string; repoId: string; name: string; language?: string; org?: string }): Promise<void> {
    const tid = this.tid(event.tenantId)
    await this.kg.upsertEntity({ type: 'Repo', name: event.name, metadata: { repoId: event.repoId, language: event.language, org: event.org } }, tid)
  }

  private async onNamespaceCreated(event: { tenantId: string; name: string; services?: string[] }): Promise<void> {
    const tid = this.tid(event.tenantId)
    const entityId = await this.kg.upsertEntity({ type: 'Namespace', name: event.name, metadata: {} }, tid)
    if (entityId && event.services) {
      for (const svc of event.services) {
        const svcId = await this.kg.upsertEntity({ type: 'Service', name: svc, metadata: { namespace: event.name } }, tid)
        if (svcId) await this.kg.upsertRelationship({ fromEntityId: svcId, relType: 'HOSTED_IN', toEntityId: entityId }, tid)
      }
    }
  }

  private async onResourceAdded(event: { tenantId: string; resourceId: string; resourceType: string; tags?: Record<string, string>; service?: string; team?: string }): Promise<void> {
    const tid = this.tid(event.tenantId)
    const entityId = await this.kg.upsertEntity({ type: 'Resource', name: event.resourceId, metadata: { resourceType: event.resourceType, tags: event.tags ?? {}, service: event.service, team: event.team } }, tid)
    if (entityId && event.service) {
      const svcId = await this.kg.upsertEntity({ type: 'Service', name: event.service, metadata: {} }, tid)
      if (svcId) await this.kg.upsertRelationship({ fromEntityId: entityId, relType: 'HOSTED_IN', toEntityId: svcId }, tid)
    }
  }

  private async onTeamChanged(event: { tenantId: string; teamId: string; name: string; members?: string[]; slackChannel?: string }): Promise<void> {
    const tid = this.tid(event.tenantId)
    const teamId = await this.kg.upsertEntity({ type: 'Team', name: event.name, metadata: { teamId: event.teamId, slackChannel: event.slackChannel } }, tid)
    if (teamId && event.members) {
      for (const member of event.members) {
        const engId = await this.kg.upsertEntity({ type: 'Engineer', name: member, metadata: {} }, tid)
        if (engId) await this.kg.upsertRelationship({ fromEntityId: engId, relType: 'MEMBER_OF', toEntityId: teamId }, tid)
      }
    }
  }

  private async onOncallRotation(event: { tenantId: string; teamId: string; engineerId: string; engineerName?: string; validFrom: string; validTo?: string }): Promise<void> {
    const tid = this.tid(event.tenantId)
    const teamEntityId = await this.kg.upsertEntity({ type: 'Team', name: event.teamId, metadata: {} }, tid)
    const engEntityId = await this.kg.upsertEntity({ type: 'Engineer', name: event.engineerName ?? event.engineerId, metadata: { engineerId: event.engineerId } }, tid)
    if (teamEntityId && engEntityId) {
      await this.kg.upsertRelationship({ fromEntityId: teamEntityId, relType: 'ONCALL', toEntityId: engEntityId, metadata: { validFrom: event.validFrom, validTo: event.validTo } }, tid)
    }
  }

  private async onConnectorCapabilityChanged(event: { tenantId: string; connectorId: string; connectorType: string }): Promise<void> {
    const tid = this.tid(event.tenantId)
    await this.kg.markConnectorEntitiesStale(event.connectorType, tid)
    await this.kg.addEpisode({ tenantId: tid, source: 'connector_capability_changed', text: `Connector ${event.connectorType} capability changed — entities marked stale for re-index`, timestamp: new Date() })
  }
}
