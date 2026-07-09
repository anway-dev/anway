import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import crypto from 'node:crypto'
import { GraphBuilderAgent } from '@anway/agent'
import type { GraphEvent, IConnectorBootstrap, IKnowledgeGraph } from '@anway/agent'
import { ProviderFactory } from '@anway/agent'
import type { ProviderConfig } from '@anway/agent'
import type { TenantId } from '@anway/types'
import { createKnowledgeGraph } from '../kb/index.js'
import { claimEvent, publishDurable } from '../events/durable-events.js'
import { ensureGithubWebhook } from '../events/webhook-registrar.js'
import { runTenantMappingPhase } from './mapper.js'
import { startGraphWorker } from './queue.js'
// Tier 1 — fully operational
import { GitHubBootstrap } from '@anway/connector-github'
import { ArgocdBootstrap } from '@anway/connector-argocd'
import { DatadogBootstrap } from '@anway/connector-datadog'
import { LinearBootstrap } from '@anway/connector-linear'
import { KubernetesBootstrap } from '@anway/connector-k8s'
import { LokiBootstrap } from '@anway/connector-loki'
import { PrometheusBootstrap } from '@anway/connector-prometheus'
import { JiraBootstrap } from '@anway/connector-jira'
import { SlackBootstrap } from '@anway/connector-slack'
import { SentryBootstrap } from '@anway/connector-sentry'
import { JenkinsBootstrap } from '@anway/connector-jenkins'
import { PagerdutyBootstrap } from '@anway/connector-pagerduty'
import { GrafanaBootstrap } from '@anway/connector-grafana'
import { OpsGenieBootstrap } from '@anway/connector-opsgenie'
import { NewRelicBootstrap } from '@anway/connector-newrelic'
import { CircleCIBootstrap } from '@anway/connector-circleci'
import { ConfluenceBootstrap } from '@anway/connector-confluence'
// Tier 2+3 — fully wired
import { CoralogixBootstrap } from '@anway/connector-coralogix'
import { DynatraceBootstrap } from '@anway/connector-dynatrace'
import { ElasticsearchBootstrap } from '@anway/connector-elastic'
import { LaunchDarklyBootstrap } from '@anway/connector-launchdarkly'
import { NotionBootstrap } from '@anway/connector-notion'
import { SnykBootstrap } from '@anway/connector-snyk'
import { SonarQubeBootstrap } from '@anway/connector-sonarqube'
import { TerraformBootstrap } from '@anway/connector-terraform'
import { VaultBootstrap } from '@anway/connector-vault'
import { VercelBootstrap } from '@anway/connector-vercel'
import { AwsCloudwatchBootstrap } from '@anway/connector-aws-cloudwatch'
import { EcsBootstrap } from '@anway/connector-ecs'
import { AwsHealthBootstrap } from '@anway/connector-aws-health'
import { AzureMonitorBootstrap } from '@anway/connector-azure-monitor'
import { GcpMonitoringBootstrap } from '@anway/connector-gcp-monitoring'
// mcp/cli are NOT registered here — they're multi-instance templates that
// live in the separate `connectors` table (apps/gateway/src/connectors/
// registry.ts's register_connector), with classification + graph bootstrap
// run inline at registration time, not via this connector_config-keyed
// event-driven registry (which requires exactly one row per connector_type
// per tenant, wrong for a template many real instances share).
// (avoid build-time dependency on packages that may not have dist/ built)

// Alertmanager is a native connector (no separate package) — bootstrap inline
import type { TenantId as TID } from '@anway/types'
// T26 — kb_entries write path: composes Service entity content, embeds it,
// and INSERTs INTO kb_entries for pgvector semantic search.
let providerConfigForEmbedding: ProviderConfig | null = null
async function writeKnowledgeEntries(tid: string, providerConfig: ProviderConfig | null, eventType: string, log?: SubscriberLogger): Promise<void> {
  if (!providerConfig) { log?.warn({ eventType }, 'kb_entries: no provider config — skipping'); return }
  const embedder = ProviderFactory.createEmbedder(providerConfig)
  if (!embedder) { log?.warn({ eventType }, 'kb_entries: no embedder — skipping'); return }
  log?.info({ eventType }, 'kb_entries: writing knowledge entries')
  try {
    const serviceEntities = await withTenant(prisma, tid, (tx) =>
      tx.$queryRaw<Array<{ name: string; type: string; metadata: Record<string, unknown> }>>`
        SELECT name, type, metadata FROM entities
        WHERE tenant_id = ${tid}::uuid AND type = 'Service'
        ORDER BY name LIMIT 200
      `
    ).catch(() => [] as Array<{ name: string; type: string; metadata: Record<string, unknown> }>)
    let written = 0
    let skipped = 0
    for (const entity of serviceEntities) {
      try {
        const content = `${entity.type}: ${entity.name} — ${JSON.stringify(entity.metadata ?? {})}`
        const contentHash = Buffer.from(content).toString('base64').slice(0, 32)
        const existing = await withTenant(prisma, tid, (tx) =>
          tx.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*) as count FROM kb_entries
            WHERE tenant_id = ${tid}::uuid AND source = ${contentHash}
          `
        ).catch(() => [{ count: 0n }] as Array<{ count: bigint }>)
        if (Number(existing[0]?.count ?? 0n) > 0) { skipped++; continue }
        const vecs = await embedder.embed([content])
        const vec = vecs[0]
        if (vec && vec.length > 0) {
          const vectorLiteral = `[${vec.join(',')}]`
          const ttl = eventType === 'pr_merged' || eventType === 'deploy_completed' ? 300 : 7200
          const inserted = await withTenant(prisma, tid, (tx) =>
            tx.$executeRaw`
              INSERT INTO kb_entries (tenant_id, source, content, embedding, fetched_at, ttl_seconds, freshness_score)
              VALUES (${tid}::uuid, ${contentHash}, ${content}, ${vectorLiteral}::vector, NOW(), ${ttl}, 1.0)
            `
          ).catch(() => 0)
          if (Number(inserted) > 0) written++
        }
      } catch (err) {
        skipped++
        log?.warn({ err, entity: entity.name }, 'kb_entries: embed/write failed for entity — skipping')
      }
    }
    log?.info({ eventType, written, skipped, total: serviceEntities.length }, 'kb_entries: write cycle complete')
  } catch (err) {
    log?.error({ err, eventType }, 'kb_entries: write cycle failed')
  }
}

class AlertmanagerBootstrapImpl implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}
  async bootstrap(tenantId: TID, connectorId: string, _payload: Record<string, unknown>) {
    const entityId = await this.kg.upsertEntity({
      type: 'Alert', name: 'alertmanager-active',
      metadata: { source: 'alertmanager', connectorId, status: 'active' },
    }, tenantId)
    return { entitiesUpserted: entityId ? 1 : 0, relationshipsUpserted: 0, episodeHints: ['Alertmanager connector bootstrapped'] }
  }
}

import { UUID_RE } from '../utils/validators.js'
import { decryptJson } from '../utils/crypto.js'
import { effectiveCredentials } from '../utils/credentials.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { appendAuditEvent } from '../routes/audit.js'
interface SubscriberLogger { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }

async function connectorCredential(tenantId: string, connectorType: string, envVar: string): Promise<string> {
  const row = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<{ credentials_enc: string }[]>`
      SELECT credentials_enc FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${connectorType} AND enabled = true
    `
  ).catch(() => [])
  if (row.length > 0) {
    const r = row[0]!
    if (r.credentials_enc) {
      const dec = decryptJson<{ token?: string; apiKey?: string }>(r.credentials_enc)
      return dec.token ?? dec.apiKey ?? process.env[envVar] ?? ''
    }
  }
  return process.env[envVar] ?? ''
}

const GRAPH_EVENT_CHANNELS = [
  'pr_merged', 'deploy_completed', 'incident_created', 'alert_fired',
  'ticket_created', 'connector_registered', 'connector_removed',
  'connector_reconnected',
  // T17 — missing lifecycle channels
  'project_created', 'repo_created', 'namespace_created',
  'resource_added', 'team_changed', 'oncall_rotation',
  'connector_capability_changed',
]

const MAX_REGISTRY_CACHE = 200
const registryCache = new Map<string, Map<string, IConnectorBootstrap>>()

/** Resolve provider config: DB first (per-tenant), env vars as fallback. */
async function resolveProviderConfig(tenantId?: string): Promise<ProviderConfig | null> {
  if (tenantId) {
    try {
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ provider: string; api_key_enc: string; base_url: string; default_model: string; cheap_model: string }>>`
          SELECT provider, api_key_enc, base_url, default_model, cheap_model
          FROM provider_config WHERE tenant_id = ${tenantId}::uuid
        `
      )
      const KEYLESS = new Set(['ollama', 'lmstudio'])
      if (rows.length > 0 && (rows[0]!.api_key_enc || KEYLESS.has(rows[0]!.provider))) {
        const r = rows[0]!
        return {
          type: r.provider as ProviderConfig['type'],
          apiKey: r.api_key_enc ? decryptJson<string>(r.api_key_enc) : undefined,
          baseURL: r.base_url || undefined,
          defaultModel: r.default_model || undefined,
          cheapModel: r.cheap_model || undefined,
        }
      }
    } catch { /* fall through to env vars */ }
  }
  if (process.env['ANTHROPIC_API_KEY']) return { type: 'anthropic' as const, apiKey: process.env['ANTHROPIC_API_KEY']! }
  if (process.env['OPENAI_API_KEY']) return { type: 'openai' as const, apiKey: process.env['OPENAI_API_KEY']! }
  if (process.env['GROQ_API_KEY']) return { type: 'groq' as const, apiKey: process.env['GROQ_API_KEY']! }
  if (process.env['MISTRAL_API_KEY']) return { type: 'mistral' as const, apiKey: process.env['MISTRAL_API_KEY']! }
  if (process.env['OLLAMA_ENDPOINT']) return { type: 'ollama' as const, baseURL: process.env['OLLAMA_ENDPOINT']! }
  if (process.env['LMSTUDIO_ENDPOINT']) return { type: 'lmstudio' as const, baseURL: process.env['LMSTUDIO_ENDPOINT']! }
  return null
}

async function buildBootstrapRegistry(kg: ReturnType<typeof createKnowledgeGraph>, tid: string): Promise<Map<string, IConnectorBootstrap>> {
  const reg = new Map<string, IConnectorBootstrap>()
  // Tier 1 — fully operational
  reg.set('github', new GitHubBootstrap(kg))
  reg.set('argocd', new ArgocdBootstrap(kg))
  reg.set('datadog', new DatadogBootstrap(kg))
  const linearToken = await connectorCredential(tid, 'linear', 'LINEAR_API_KEY')
  reg.set('linear', new LinearBootstrap(kg, linearToken))
  reg.set('prometheus', new PrometheusBootstrap(kg))
  reg.set('loki', new LokiBootstrap(kg))
  reg.set('k8s', new KubernetesBootstrap(kg))
  reg.set('eks', new KubernetesBootstrap(kg))
  reg.set('gke', new KubernetesBootstrap(kg))
  reg.set('aks', new KubernetesBootstrap(kg))
  reg.set('jira', new JiraBootstrap(kg))
  reg.set('slack', new SlackBootstrap(kg))
  reg.set('sentry', new SentryBootstrap(kg))
  reg.set('jenkins', new JenkinsBootstrap(kg))
  reg.set('pagerduty', new PagerdutyBootstrap(kg))
  reg.set('grafana', new GrafanaBootstrap(kg))
  reg.set('opsgenie', new OpsGenieBootstrap(kg))
  reg.set('newrelic', new NewRelicBootstrap(kg))
  reg.set('circleci', new CircleCIBootstrap(kg))
  reg.set('confluence', new ConfluenceBootstrap(kg))
  // Tier 2+3 — fully wired
  reg.set('coralogix', new CoralogixBootstrap(kg))
  reg.set('dynatrace', new DynatraceBootstrap(kg))
  reg.set('elastic', new ElasticsearchBootstrap(kg))
  reg.set('launchdarkly', new LaunchDarklyBootstrap(kg))
  reg.set('notion', new NotionBootstrap(kg))
  reg.set('snyk', new SnykBootstrap(kg))
  reg.set('sonarqube', new SonarQubeBootstrap(kg))
  reg.set('terraform', new TerraformBootstrap(kg))
  reg.set('vault', new VaultBootstrap(kg))
  reg.set('vercel', new VercelBootstrap(kg))
  reg.set('aws-cloudwatch', new AwsCloudwatchBootstrap(kg))
  reg.set('ecs', new EcsBootstrap(kg))  // T27
  // Cloud monitoring — previously missing bootstraps (T14)
  reg.set('aws-health', new AwsHealthBootstrap(kg))
  reg.set('azure-monitor', new AzureMonitorBootstrap(kg))
  reg.set('gcp-monitoring', new GcpMonitoringBootstrap(kg))
  reg.set('alertmanager', new AlertmanagerBootstrapImpl(kg))
  return reg
}

export async function startGraphBuilderSubscriber(redisUrl: string, log: SubscriberLogger): Promise<void> {
  const sub: RedisClientType = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
    },
  })
  sub.on('error', (err: Error) => log.error({ err }, 'Redis subscriber error — will reconnect'))
  await sub.connect()
  const graphPub = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
    },
  })
  graphPub.on('error', (err: Error) => log.error({ err }, 'Redis graphPub error — will reconnect'))
  await graphPub.connect()

  for (const channel of GRAPH_EVENT_CHANNELS) {
    await sub.subscribe(channel, async (message) => {
      let event: GraphEvent & { tenantId: string }
      try { event = JSON.parse(message) } catch { return }
      if (typeof event.tenantId !== 'string' || !UUID_RE.test(event.tenantId)) {
        log.warn({ channel, tenantId: event.tenantId }, 'graph-builder subscriber: invalid tenantId — skipping')
        return
      }
      const tid = event.tenantId

      // Cross-replica dedupe (durable-events.ts): with >1 gateway replica,
      // every replica receives every pub/sub message — exactly one claims
      // it. Bootstrap events additionally keep their own Redis lock below
      // (protects against non-outbox publishers like boot-scan too).
      const eventLogId = (event as { __eventLogId?: string }).__eventLogId
      if (!(await claimEvent(eventLogId, tid, 'graph-builder'))) return

      // Extract connectorType once; only set for connector lifecycle events
      const eventConnectorType = (event as { connectorType?: string }).connectorType

      const providerConfig = await resolveProviderConfig(tid)
      providerConfigForEmbedding = providerConfig  // T26: for kb_entries write path
      if (!providerConfig) {
        log.warn({ tenantId: tid }, 'GraphBuilderSubscriber: no LLM provider configured — skipping')
        return
      }
      const provider = ProviderFactory.create(providerConfig)
      const kg = createKnowledgeGraph(tid as TenantId)

      // Invalidate bootstrap registry cache on connector lifecycle events so
      // credential changes propagate. Previously frozen forever after first build.
      if (event.type === 'connector_registered' || event.type === 'connector_reconnected') {
        registryCache.delete(tid)
      }

      if (!registryCache.has(tid)) {
        if (registryCache.size >= MAX_REGISTRY_CACHE) {
          const k = registryCache.keys().next().value
          if (k !== undefined) registryCache.delete(k)
        }
        registryCache.set(tid, await buildBootstrapRegistry(kg, tid))
      }
      const bootstrapRegistry = registryCache.get(tid)!
      const agent = new GraphBuilderAgent(kg, provider, log, bootstrapRegistry, graphPub)

      // Connector lifecycle events re-published internally (e.g. kb:stale) carry no
      // payload — load stored credentials so bootstrap reaches the right endpoint.
      if ((event.type === 'connector_registered' || event.type === 'connector_reconnected') && eventConnectorType) {
        const existing = (event as { payload?: Record<string, unknown> }).payload
        if (!existing || Object.keys(existing).length === 0) {
          const eventConnectorId = (event as { connectorId?: string }).connectorId
          // connectorId is the real connector_config row UUID (post multi-instance
          // fix) — look up by id when it's a real UUID, since connector_type alone
          // is ambiguous once multiple instances of the same type can exist
          // (mcp/cli). Falls back to type-based lookup only for any caller still
          // passing the bare type string as connectorId.
          const rows = eventConnectorId && UUID_RE.test(eventConnectorId)
            ? await withTenant(prisma, tid, (tx) =>
                tx.$queryRaw<Array<{ credentials_enc: string | null; credentials: Record<string, unknown>; capability_manifest: Record<string, unknown> | null }>>`
                  SELECT credentials_enc, capability_manifest FROM connector_config
                  WHERE tenant_id = ${tid}::uuid AND id = ${eventConnectorId}::uuid AND enabled = true
                `
              ).catch(() => [])
            : await withTenant(prisma, tid, (tx) =>
                tx.$queryRaw<Array<{ credentials_enc: string | null; credentials: Record<string, unknown>; capability_manifest: Record<string, unknown> | null }>>`
                  SELECT credentials_enc, capability_manifest FROM connector_config
                  WHERE tenant_id = ${tid}::uuid AND connector_type = ${eventConnectorType} AND enabled = true
                `
              ).catch(() => [])
          const creds = effectiveCredentials(rows[0])
          // Re-attach a previously-classified toolRoleMap (mcp/cli) so a
          // reconnect doesn't re-pay a model call to reclassify tools it
          // already knows about.
          const storedRoleMap = rows[0]?.capability_manifest?.['toolRoleMap']
          if (storedRoleMap) creds['toolRoleMap'] = storedRoleMap
          if (Object.keys(creds).length > 0) (event as { payload?: Record<string, unknown> }).payload = creds
        }
      }

      // Distributed lock — only one container bootstraps per connector per tenant.
      // Keyed by connectorId (the real connector_config row UUID), not
      // connector_type — every caller that clears this lock (settings.ts,
      // connectors.ts, boot-scan.ts) does so by connectorId, and keying by
      // type alone would also serialize unrelated instances of the same
      // multi-instance type (mcp/cli) behind one shared lock.
      let lockKey: string | null = null
      // Random per-attempt token (not a fixed '1') — the release below
      // compares this exact value before deleting, so a stale/expired lock
      // held by a *different* instance is never accidentally deleted by
      // this one (the classic "unlock without an ownership check" bug,
      // confirmed live via independent review: with the previous fixed
      // value, any instance could unconditionally del(lockKey) in its
      // `finally` block, including deleting a lock a *different* instance
      // had legitimately re-acquired after this one's lock already expired).
      const lockToken = crypto.randomUUID()
      if (event.type === 'connector_registered' || event.type === 'connector_reconnected') {
        const eventConnectorId = (event as { connectorId?: string }).connectorId ?? eventConnectorType
        lockKey = `graph:bootstrap:lock:${tid}:${eventConnectorId}`
        // 60s was too short for a real multi-minute bootstrap (confirmed
        // live) — the lock would expire mid-bootstrap and let a second
        // instance start a concurrent, duplicate bootstrap for the same
        // connector. 10 minutes covers a real cold bootstrap; idempotent
        // upserts mean a false-negative (lock expires just before finish)
        // is harmless, unlike the previous false-positive (concurrent runs).
        const acquired = await graphPub.set(lockKey, lockToken, { NX: true, EX: 600 })
        if (!acquired) {
          log.info({ lockKey }, 'GraphBuilderSubscriber: bootstrap lock held by another instance — skipping')
          appendAuditEvent({ tenantId: tid, action: 'connector.bootstrap_queued', resource: eventConnectorType ?? '', outcome: 'success', metadata: { connectorType: eventConnectorType, message: 'Bootstrap already in progress — will retry automatically in ~5 min. Click Force Resync to retry now.' } }).catch(() => {})
          return
        }
      }
      const K8S_TYPES = new Set(['k8s', 'eks', 'gke', 'aks'])
      const isBootstrapEvent = event.type === 'connector_registered' || event.type === 'connector_reconnected'
      // Real connector_config row UUID for this event, when available — every
      // status/summary write below must key on this, not connector_type alone,
      // or a second instance of a multi-instance type (mcp/cli) clobbers the
      // first's bootstrapped_at/last_bootstrap_summary.
      const eventConnectorId = (event as { connectorId?: string }).connectorId
      if (isBootstrapEvent && eventConnectorType) {
        appendAuditEvent({ tenantId: tid, action: 'connector.bootstrap_started', resource: eventConnectorType, outcome: 'success', metadata: { connectorType: eventConnectorType, message: 'Bootstrap started' } }).catch(() => {})
      }
      try {
        await agent.handle(event)

        // T26: Write kb_entries for Service entities after bootstrap/event.
        // Composes entity content → embeds → INSERT INTO kb_entries for pgvector search.
        await writeKnowledgeEntries(tid, providerConfig, event.type, log)

        if (isBootstrapEvent) {
          const connectorType = eventConnectorType
          if (connectorType) {
            // Preserve existing namespace_filter across rebootstrap
            let existingFilter: string[] | null = null
            try {
              const prevRows = eventConnectorId && UUID_RE.test(eventConnectorId)
                ? await withTenant(prisma, tid, (tx) =>
                    tx.$queryRaw<{ last_bootstrap_summary: Record<string, unknown> | null }[]>`
                      SELECT last_bootstrap_summary FROM connector_config
                      WHERE tenant_id = ${tid}::uuid AND id = ${eventConnectorId}::uuid
                    `
                  )
                : await withTenant(prisma, tid, (tx) =>
                    tx.$queryRaw<{ last_bootstrap_summary: Record<string, unknown> | null }[]>`
                      SELECT last_bootstrap_summary FROM connector_config
                      WHERE tenant_id = ${tid}::uuid AND connector_type = ${connectorType}
                    `
                  )
              const prev = prevRows[0]?.last_bootstrap_summary
              if (prev && Array.isArray(prev['namespace_filter'])) {
                existingFilter = prev['namespace_filter'] as string[]
              }
            } catch { /* ignore */ }

            // For k8s-type connectors, fetch discovered namespaces from entities table
            let discoveredNamespaces: string[] | undefined
            if (K8S_TYPES.has(connectorType)) {
              const nsRows = await withTenant(prisma, tid, (tx) =>
                tx.$queryRaw<{ name: string }[]>`
                  SELECT name FROM entities
                  WHERE tenant_id = ${tid}::uuid AND type = 'Namespace'
                  ORDER BY name
                `
              ).catch(() => [] as { name: string }[])
              discoveredNamespaces = nsRows.map(r => r.name)
            }

            const summary: Record<string, unknown> = { status: 'success', at: new Date().toISOString() }
            if (discoveredNamespaces !== undefined) summary['namespaces'] = discoveredNamespaces
            if (existingFilter !== null) summary['namespace_filter'] = existingFilter

            void (eventConnectorId && UUID_RE.test(eventConnectorId)
              ? withTenant(prisma, tid, (tx) =>
                  tx.$executeRaw`
                    UPDATE connector_config
                    SET bootstrapped_at = NOW(),
                        last_bootstrap_summary = ${JSON.stringify(summary)}::jsonb
                    WHERE tenant_id = ${tid}::uuid AND id = ${eventConnectorId}::uuid
                  `
                )
              : withTenant(prisma, tid, (tx) =>
                  tx.$executeRaw`
                    UPDATE connector_config
                    SET bootstrapped_at = NOW(),
                        last_bootstrap_summary = ${JSON.stringify(summary)}::jsonb
                    WHERE tenant_id = ${tid}::uuid AND connector_type = ${connectorType}
                  `
                )
            ).catch((err: Error) => log.warn({ err, connectorType, tenantId: tid }, 'failed to write bootstrapped_at'))

            const nsCount = discoveredNamespaces?.length
            appendAuditEvent({
              tenantId: tid, action: 'connector.bootstrap_completed', resource: connectorType, outcome: 'success',
              metadata: { connectorType, message: nsCount !== undefined ? `Bootstrap complete — ${nsCount} namespace${nsCount !== 1 ? 's' : ''} discovered` : 'Bootstrap complete' },
            }).catch(() => {})

            // Ongoing sync: register the vendor webhook after a successful
            // bootstrap (CLAUDE.md: "After bootstrap, connector registers
            // event subscriptions"). Best-effort + idempotent — failure or
            // a missing ANWAY_PUBLIC_URL falls back to connector-poller.ts,
            // audit-logged either way inside the registrar.
            if (connectorType === 'github' && eventConnectorId && UUID_RE.test(eventConnectorId)) {
              const bootstrapCreds = (event as { payload?: Record<string, unknown> }).payload ?? {}
              void ensureGithubWebhook(tid, eventConnectorId, bootstrapCreds)
                .catch((err: Error) => log.warn({ err, tenantId: tid }, 'github webhook registration errored'))
            }

            // Mapping phase — runs after every bootstrap to resolve cross-entity relationships
            appendAuditEvent({ tenantId: tid, action: 'connector.mapping_started', resource: connectorType, outcome: 'success', metadata: { connectorType, message: 'Resolving entity relationships…' } }).catch(() => {})
            runTenantMappingPhase(tid).then((mapResult) => {
              appendAuditEvent({ tenantId: tid, action: 'connector.mapping_completed', resource: connectorType, outcome: 'success', metadata: { connectorType, relationshipsUpserted: mapResult.relationshipsUpserted, message: `Mapping complete — ${mapResult.relationshipsUpserted} relationship${mapResult.relationshipsUpserted !== 1 ? 's' : ''} resolved` } }).catch(() => {})
              log.info({ tenantId: tid, connectorType, ...mapResult }, 'mapping phase complete')
            }).catch((err: Error) => {
              log.warn({ err, tenantId: tid, connectorType }, 'mapping phase failed — non-critical, will retry on next cycle')
            })
          }
        }
      } catch (err) {
        log.error({ err, eventType: event.type, tenantId: tid }, 'GraphBuilderAgent event handling failed')
        if (isBootstrapEvent) {
          const connectorType = eventConnectorType
          if (connectorType) {
            const errSummary = JSON.stringify({ status: 'error', error: String(err), at: new Date().toISOString() })
            void (eventConnectorId && UUID_RE.test(eventConnectorId)
              ? withTenant(prisma, tid, (tx) =>
                  tx.$executeRaw`
                    UPDATE connector_config SET last_bootstrap_summary = ${errSummary}::jsonb
                    WHERE tenant_id = ${tid}::uuid AND id = ${eventConnectorId}::uuid
                  `
                )
              : withTenant(prisma, tid, (tx) =>
                  tx.$executeRaw`
                    UPDATE connector_config SET last_bootstrap_summary = ${errSummary}::jsonb
                    WHERE tenant_id = ${tid}::uuid AND connector_type = ${connectorType}
                  `
                )
            ).catch(() => {})

            appendAuditEvent({
              tenantId: tid, action: 'connector.bootstrap_failed', resource: connectorType, outcome: 'failed',
              metadata: { connectorType, message: `Bootstrap failed: ${String(err).slice(0, 200)}` },
            }).catch(() => {})
          }
        }
      } finally {
        // Atomic compare-then-delete (Lua, single round-trip) — only removes
        // the lock if it still holds *this instance's* token. If it expired
        // and a different instance already re-acquired it with a new token,
        // this correctly leaves that instance's lock alone instead of
        // deleting it out from under it.
        if (lockKey) {
          await graphPub.eval(
            `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`,
            { keys: [lockKey], arguments: [lockToken] },
          ).catch(() => {})
        }
      }
    })
  }

  // Subscribe to kb:stale — re-trigger bootstrap for stale connector sources
  await sub.subscribe('kb:stale', async (message) => {
    try {
      const { sources } = JSON.parse(message) as { count: number; sources: string[] }
      if (!Array.isArray(sources)) return
      for (const source of sources) {
        // Re-bootstrap every tenant that has this connector enabled — not just
        // the default tenant. Re-sweeps EVERY row of this type per tenant now
        // (not just one) — a multi-instance type (mcp/cli) has multiple real
        // rows to individually re-bootstrap, each with its own connectorId.
        const rows = await prisma.$queryRaw<Array<{ id: string; tenant_id: string; credentials_enc: string | null; credentials: Record<string, unknown> }>>`
          SELECT id, tenant_id, credentials_enc FROM connector_config
          WHERE connector_type = ${source} AND enabled = true
        `.catch(() => [] as Array<{ id: string; tenant_id: string; credentials_enc: string | null; credentials: Record<string, unknown> }>)
        for (const row of rows) {
          // Payload deliberately omitted (previously carried decrypted
          // credentials): this publish is durable now — the outbox persists
          // the payload to event_log and plaintext credentials must never
          // land there. The empty-payload branch below loads stored
          // credentials from connector_config by connectorId.
          await publishDurable(graphPub as never, row.tenant_id, 'connector_reconnected', {
            type: 'connector_reconnected',
            tenantId: row.tenant_id,
            connectorType: source,
            connectorId: row.id,
            at: new Date().toISOString(),
          }).catch(() => {})
        }
      }
    } catch { /* ignore parse errors */ }
  })

  log.info({ channels: [...GRAPH_EVENT_CHANNELS, 'kb:stale'] }, 'GraphBuilderSubscriber started')
}

export async function startGraphBuilderWorker(redisUrl: string, log: SubscriberLogger): Promise<void> {
  const worker = startGraphWorker(async (job) => {
    const event = job.data.event as GraphEvent & { tenantId: string }
    if (typeof event.tenantId !== 'string' || !UUID_RE.test(event.tenantId)) {
      log.warn({ tenantId: event.tenantId }, 'graph-worker: invalid tenantId — skipping')
      return
    }
    const tid = event.tenantId

    const providerConfig = await resolveProviderConfig(tid)
    providerConfigForEmbedding = providerConfig  // T26: for kb_entries write path
    if (!providerConfig) {
      log.warn({ tenantId: tid }, 'GraphWorker: no LLM provider configured — skipping')
      return
    }
    const provider = ProviderFactory.create(providerConfig)
    const kg = createKnowledgeGraph(tid as TenantId)

    if (!registryCache.has(tid)) {
      if (registryCache.size >= MAX_REGISTRY_CACHE) {
        const k = registryCache.keys().next().value
        if (k !== undefined) registryCache.delete(k)
      }
      registryCache.set(tid, await buildBootstrapRegistry(kg, tid))
    }
    const bootstrapRegistry = registryCache.get(tid)!
    const pub = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
      },
    })
    pub.on('error', (err: Error) => log.error({ err }, 'Redis graph-worker pub error — will reconnect'))
    await pub.connect()
    const agent = new GraphBuilderAgent(kg, provider, log, bootstrapRegistry, pub)

    try {
      await agent.handle(event)
      if (event.type === 'connector_registered' || event.type === 'connector_reconnected') {
        const connectorType = event.connectorType
        if (connectorType) {
          void withTenant(prisma, tid, (tx) =>
            tx.$executeRaw`
              UPDATE connector_config
              SET bootstrapped_at = NOW(),
                  last_bootstrap_summary = ${JSON.stringify({ status: 'success', at: new Date().toISOString() })}::jsonb
              WHERE tenant_id = ${tid}::uuid AND connector_type = ${connectorType}
            `
          ).catch(() => {})
        }
      }
    } catch (err) {
      log.error({ err, eventType: event.type, tenantId: tid }, 'GraphWorker event handling failed')
    } finally {
      await pub.quit()
    }
  })

  if (worker) {
    log.info({}, 'GraphBuilderWorker started (BullMQ)')
  }
}
