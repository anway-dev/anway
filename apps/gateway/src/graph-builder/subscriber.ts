import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { GraphBuilderAgent } from '@anvay/agent'
import type { GraphEvent, IConnectorBootstrap, IKnowledgeGraph } from '@anvay/agent'
import { ProviderFactory } from '@anvay/agent'
import type { ProviderConfig } from '@anvay/agent'
import type { TenantId } from '@anvay/types'
import { createKnowledgeGraph } from '../kb/index.js'
import { startGraphWorker } from './queue.js'
// Tier 1 — fully operational
import { GitHubBootstrap } from '@anvay/connector-github'
import { ArgocdBootstrap } from '@anvay/connector-argocd'
import { DatadogBootstrap } from '@anvay/connector-datadog'
import { LinearBootstrap } from '@anvay/connector-linear'
import { KubernetesBootstrap } from '@anvay/connector-k8s'
import { LokiBootstrap } from '@anvay/connector-loki'
import { PrometheusBootstrap } from '@anvay/connector-prometheus'
import { JiraBootstrap } from '@anvay/connector-jira'
import { SlackBootstrap } from '@anvay/connector-slack'
import { SentryBootstrap } from '@anvay/connector-sentry'
import { JenkinsBootstrap } from '@anvay/connector-jenkins'
import { PagerdutyBootstrap } from '@anvay/connector-pagerduty'
import { GrafanaBootstrap } from '@anvay/connector-grafana'
import { OpsGenieBootstrap } from '@anvay/connector-opsgenie'
import { NewRelicBootstrap } from '@anvay/connector-newrelic'
import { CircleCIBootstrap } from '@anvay/connector-circleci'
import { ConfluenceBootstrap } from '@anvay/connector-confluence'
// Tier 2+3 — fully wired
import { CoralogixBootstrap } from '@anvay/connector-coralogix'
import { DynatraceBootstrap } from '@anvay/connector-dynatrace'
import { ElasticsearchBootstrap } from '@anvay/connector-elastic'
import { LaunchDarklyBootstrap } from '@anvay/connector-launchdarkly'
import { NotionBootstrap } from '@anvay/connector-notion'
import { SnykBootstrap } from '@anvay/connector-snyk'
import { SonarQubeBootstrap } from '@anvay/connector-sonarqube'
import { TerraformBootstrap } from '@anvay/connector-terraform'
import { VaultBootstrap } from '@anvay/connector-vault'
import { VercelBootstrap } from '@anvay/connector-vercel'
import { AwsCloudwatchBootstrap } from '@anvay/connector-aws-cloudwatch'
// (avoid build-time dependency on packages that may not have dist/ built)
import { UUID_RE } from '../utils/validators.js'
import { decryptJson } from '../utils/crypto.js'
import { effectiveCredentials } from '../utils/credentials.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
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
            tx.$queryRaw<Array<{ credentials_enc: string | null; credentials: Record<string, unknown> }>>`
              SELECT credentials_enc FROM connector_config
              WHERE tenant_id = ${tid}::uuid AND connector_type = ${event.connectorType} AND enabled = true
            `
          ).catch(() => [])
          const creds = effectiveCredentials(rows[0])
          if (Object.keys(creds).length > 0) (event as { payload?: Record<string, unknown> }).payload = creds
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
        const rows = await prisma.$queryRaw<Array<{ tenant_id: string; credentials_enc: string | null; credentials: Record<string, unknown> }>>`
          SELECT tenant_id, credentials_enc FROM connector_config
          WHERE connector_type = ${source} AND enabled = true
        `.catch(() => [] as Array<{ tenant_id: string; credentials_enc: string | null; credentials: Record<string, unknown> }>)
        for (const row of rows) {
          await graphPub.publish('connector_reconnected', JSON.stringify({
            type: 'connector_reconnected',
            tenantId: row.tenant_id,
            connectorType: source,
            connectorId: source,
            payload: effectiveCredentials(row),
            at: new Date().toISOString(),
          })).catch(() => {})
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
      registryCache.set(tid, buildBootstrapRegistry(kg, tid))
    }
    const bootstrapRegistry = registryCache.get(tid)!
    const pub = createClient({ url: redisUrl })
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
