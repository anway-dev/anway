import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { GraphBuilderAgent } from '@anvay/agent'
import type { GraphEvent, IConnectorBootstrap } from '@anvay/agent'
import { ProviderFactory } from '@anvay/agent'
import type { ProviderConfig } from '@anvay/agent'
import { createKnowledgeGraph } from '../kb/index.js'
import { GitHubBootstrap } from '@anvay/connector-github'
import { ArgocdBootstrap } from '@anvay/connector-argocd'
import { DatadogBootstrap } from '@anvay/connector-datadog'
import { LinearBootstrap } from '@anvay/connector-linear'
import { PrometheusBootstrap } from '@anvay/connector-prometheus'
import { LokiBootstrap } from '@anvay/connector-loki'
import { KubernetesBootstrap } from '@anvay/connector-k8s'
import type { TenantId } from '@anvay/types'
import { UUID_RE } from '../utils/validators.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
interface SubscriberLogger { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }

async function connectorCredential(tenantId: string, connectorType: string, envVar: string): Promise<string> {
  const row = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<{ credentials: { token?: string; apiKey?: string } }[]>`
      SELECT credentials FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${connectorType} AND enabled = true
    `
  ).catch(() => [])
  if (row.length > 0) {
    const creds = row[0]!.credentials
    return creds.token ?? creds.apiKey ?? process.env[envVar] ?? ''
  }
  return process.env[envVar] ?? ''
}

const GRAPH_EVENT_CHANNELS = [
  'pr_merged', 'deploy_completed', 'incident_created',
  'ticket_created', 'connector_registered',
]

// Cache bootstrap registry per tenant — avoids rebuilding on every Redis event
const MAX_REGISTRY_CACHE = 200
const registryCache = new Map<string, Map<string, IConnectorBootstrap>>()

function resolveProviderConfig(): ProviderConfig | null {
  if (process.env['ANTHROPIC_API_KEY']) return { type: 'anthropic' as const, apiKey: process.env['ANTHROPIC_API_KEY']! }
  if (process.env['OPENAI_API_KEY']) return { type: 'openai' as const, apiKey: process.env['OPENAI_API_KEY']! }
  if (process.env['GROQ_API_KEY']) return { type: 'groq' as const, apiKey: process.env['GROQ_API_KEY']! }
  return null
}

export async function startGraphBuilderSubscriber(redisUrl: string, log: SubscriberLogger): Promise<void> {
  const providerConfig = resolveProviderConfig()
  if (!providerConfig) {
    log.warn('GraphBuilderSubscriber: no LLM provider configured — skipping')
    return
  }
  const provider = ProviderFactory.create(providerConfig)
  const cheapModel = process.env['CHEAP_MODEL'] ?? 'claude-haiku-3-5-20251001'

  const sub: RedisClientType = createClient({ url: redisUrl })
  await sub.connect()

  // Shared publisher for graph:updated events
  const graphPub = createClient({ url: redisUrl })
  await graphPub.connect()

  for (const channel of GRAPH_EVENT_CHANNELS) {
    await sub.subscribe(channel, async (message) => {
      let event: GraphEvent & { tenantId: string }
      try {
        event = JSON.parse(message)
      } catch {
        return
      }
      if (typeof event.tenantId !== 'string' || !UUID_RE.test(event.tenantId)) {
        log.warn({ channel, tenantId: event.tenantId }, 'graph-builder subscriber: invalid tenantId — skipping')
        return
      }
      // bootstrapRegistry is rebuilt per event because kg is per-tenant.
      const tid = event.tenantId
      const kg = createKnowledgeGraph(tid as TenantId)

      // Cache bootstrap registry per tenant — avoids rebuilding on every event
      if (!registryCache.has(tid)) {
        if (registryCache.size >= MAX_REGISTRY_CACHE) {
          const k = registryCache.keys().next().value
          if (k !== undefined) registryCache.delete(k)
        }
        const reg = new Map<string, IConnectorBootstrap>()
        reg.set('github', new GitHubBootstrap(kg, await connectorCredential(tid, 'github', 'GH_TOKEN')))
        reg.set('argocd', new ArgocdBootstrap(kg))
        reg.set('datadog', new DatadogBootstrap(kg))
        reg.set('linear', new LinearBootstrap(kg, await connectorCredential(tid, 'linear', 'LINEAR_API_KEY')))
        reg.set('prometheus', new PrometheusBootstrap(kg))
        reg.set('loki', new LokiBootstrap(kg))
        reg.set('k8s', new KubernetesBootstrap(kg))
        registryCache.set(tid, reg)
      }
      const bootstrapRegistry = registryCache.get(tid)!
      const agent = new GraphBuilderAgent(kg, provider, cheapModel, log, bootstrapRegistry, graphPub)
      await agent.handle(event)
    })
  }
  log.info({ channels: GRAPH_EVENT_CHANNELS }, 'GraphBuilderSubscriber started')
}
