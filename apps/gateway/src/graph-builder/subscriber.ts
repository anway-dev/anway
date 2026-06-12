import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { GraphBuilderAgent } from '@anvay/agent'
import type { GraphEvent, IConnectorBootstrap, IKnowledgeGraph } from '@anvay/agent'
import { ProviderFactory } from '@anvay/agent'
import type { ProviderConfig } from '@anvay/agent'
import { createKnowledgeGraph } from '../kb/index.js'
// Tier 1 — fully operational
import { GitHubBootstrap } from '@anvay/connector-github'
import { ArgocdBootstrap } from '@anvay/connector-argocd'
import { DatadogBootstrap } from '@anvay/connector-datadog'
import { LinearBootstrap } from '@anvay/connector-linear'
import { KubernetesBootstrap } from '@anvay/connector-k8s'
import { LokiBootstrap } from '@anvay/connector-loki'
import { PrometheusBootstrap } from '@anvay/connector-prometheus'
// Tier 2+3 — remaining 20 connector bootstraps registered as lazy imports below
// (avoid build-time dependency on packages that may not have dist/ built)
import type { TenantId } from '@anvay/types'
import { UUID_RE } from '../utils/validators.js'
import { decryptJson } from '../utils/crypto.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
interface SubscriberLogger { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }

async function connectorCredential(tenantId: string, connectorType: string, envVar: string): Promise<string> {
  const row = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<{ credentials_enc: string; credentials: { token?: string; apiKey?: string } }[]>`
      SELECT credentials_enc, credentials FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${connectorType} AND enabled = true
    `
  ).catch(() => [])
  if (row.length > 0) {
    const r = row[0]!
    if (r.credentials_enc) {
      const dec = decryptJson<{ token?: string; apiKey?: string }>(r.credentials_enc)
      return dec.token ?? dec.apiKey ?? process.env[envVar] ?? ''
    }
    return r.credentials?.token ?? r.credentials?.apiKey ?? process.env[envVar] ?? ''
  }
  return process.env[envVar] ?? ''
}

const GRAPH_EVENT_CHANNELS = [
  'pr_merged', 'deploy_completed', 'incident_created',
  'ticket_created', 'connector_registered', 'connector_removed',
  'connector_reconnected',
]

const MAX_REGISTRY_CACHE = 200
const registryCache = new Map<string, Map<string, IConnectorBootstrap>>()

/** Resolve provider config: DB first (per-tenant), env vars as fallback. */
async function resolveProviderConfig(tenantId?: string): Promise<ProviderConfig | null> {
  if (tenantId) {
    try {
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ provider: string; api_key: string; api_key_enc: string; base_url: string; default_model: string; cheap_model: string }>>`
          SELECT provider, api_key, api_key_enc, base_url, default_model, cheap_model
          FROM provider_config WHERE tenant_id = ${tenantId}::uuid
        `
      )
      const KEYLESS = new Set(['ollama', 'lmstudio'])
      if (rows.length > 0 && (rows[0]!.api_key || rows[0]!.api_key_enc || KEYLESS.has(rows[0]!.provider))) {
        const r = rows[0]!
        return {
          type: r.provider as ProviderConfig['type'],
          apiKey: r.api_key_enc ? decryptJson<string>(r.api_key_enc) : (r.api_key || undefined),
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
  return null
}

/** No-op bootstrap for connectors that don't have their package built yet. */
class NoopBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph, private readonly name: string) {}
  async bootstrap(): Promise<{ entitiesUpserted: number; relationshipsUpserted: number; episodeHints: string[] }> {
    return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`${this.name}: bootstrap package not yet imported (pending build)`] }
  }
}

function buildBootstrapRegistry(kg: ReturnType<typeof createKnowledgeGraph>, tid: string): Map<string, IConnectorBootstrap> {
  const reg = new Map<string, IConnectorBootstrap>()
  // Tier 1 — fully operational
  void connectorCredential(tid, 'github', 'GH_TOKEN').then(t => reg.set('github', new GitHubBootstrap(kg, t)))
  reg.set('argocd', new ArgocdBootstrap(kg))
  reg.set('datadog', new DatadogBootstrap(kg))
  void connectorCredential(tid, 'linear', 'LINEAR_API_KEY').then(t => reg.set('linear', new LinearBootstrap(kg, t)))
  reg.set('prometheus', new PrometheusBootstrap(kg))
  reg.set('loki', new LokiBootstrap(kg))
  reg.set('k8s', new KubernetesBootstrap(kg))
  // Tier 2+3 — registered as no-op stubs (packages pending build)
  // As each connector package is built, replace NoopBootstrap with real import
  const pendingConnectors = [
    'pagerduty','grafana','circleci','confluence','coralogix','dynatrace',
    'elastic','jenkins','jira','launchdarkly','newrelic','notion','opsgenie',
    'sentry','slack','snyk','sonarqube','terraform','vault','vercel',
  ]
  for (const name of pendingConnectors) {
    reg.set(name, new NoopBootstrap(kg, name))
  }
  return reg
}

export async function startGraphBuilderSubscriber(redisUrl: string, log: SubscriberLogger): Promise<void> {
  const sub: RedisClientType = createClient({ url: redisUrl })
  await sub.connect()
  const graphPub = createClient({ url: redisUrl })
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

      const providerConfig = await resolveProviderConfig(tid)
      if (!providerConfig) {
        log.warn({ tenantId: tid }, 'GraphBuilderSubscriber: no LLM provider configured — skipping')
        return
      }
      const provider = ProviderFactory.create(providerConfig)
      const kg = createKnowledgeGraph(tid as TenantId)

      if (!registryCache.has(tid)) {
        if (registryCache.size >= MAX_REGISTRY_CACHE) {
          const k = registryCache.keys().next().value
          if (k !== undefined) registryCache.delete(k)
        }
        registryCache.set(tid, buildBootstrapRegistry(kg, tid))
      }
      const bootstrapRegistry = registryCache.get(tid)!
      const agent = new GraphBuilderAgent(kg, provider, log, bootstrapRegistry, graphPub)

      // Connector lifecycle events re-published internally (e.g. kb:stale) carry no
      // payload — load stored credentials so bootstrap reaches the right endpoint.
      if ((event.type === 'connector_registered' || event.type === 'connector_reconnected') && event.connectorType) {
        const existing = (event as { payload?: Record<string, unknown> }).payload
        if (!existing || Object.keys(existing).length === 0) {
          const rows = await withTenant(prisma, tid, (tx) =>
            tx.$queryRaw<Array<{ credentials: Record<string, unknown> }>>`
              SELECT credentials_enc, credentials FROM connector_config
              WHERE tenant_id = ${tid}::uuid AND connector_type = ${event.connectorType} AND enabled = true
            `
          ).catch(() => [])
          if (rows[0]?.credentials) (event as { payload?: Record<string, unknown> }).payload = rows[0].credentials
        }
      }

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
            ).catch((err: Error) => log.warn({ err, connectorType, tenantId: tid }, 'failed to write bootstrapped_at'))
          }
        }
      } catch (err) {
        log.error({ err, eventType: event.type, tenantId: tid }, 'GraphBuilderAgent event handling failed')
        if (event.type === 'connector_registered' || event.type === 'connector_reconnected') {
          const connectorType = event.connectorType
          if (connectorType) {
            void withTenant(prisma, tid, (tx) =>
              tx.$executeRaw`
                UPDATE connector_config
                SET last_bootstrap_summary = ${JSON.stringify({ status: 'error', error: String(err), at: new Date().toISOString() })}::jsonb
                WHERE tenant_id = ${tid}::uuid AND connector_type = ${connectorType}
              `
            ).catch(() => {})
          }
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
        // Re-bootstrap every tenant that has this connector enabled — not just the default tenant
        const rows = await prisma.$queryRaw<Array<{ tenant_id: string; credentials: Record<string, unknown> }>>`
          SELECT tenant_id, credentials FROM connector_config
          WHERE connector_type = ${source} AND enabled = true
        `.catch(() => [] as Array<{ tenant_id: string; credentials: Record<string, unknown> }>)
        for (const row of rows) {
          await graphPub.publish('connector_reconnected', JSON.stringify({
            type: 'connector_reconnected',
            tenantId: row.tenant_id,
            connectorType: source,
            connectorId: source,
            payload: row.credentials,
            at: new Date().toISOString(),
          })).catch(() => {})
        }
      }
    } catch { /* ignore parse errors */ }
  })

  log.info({ channels: [...GRAPH_EVENT_CHANNELS, 'kb:stale'] }, 'GraphBuilderSubscriber started')
}
