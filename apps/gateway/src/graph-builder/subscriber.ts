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
import type { TenantId } from '@anvay/types'
interface SubscriberLogger { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }

const GRAPH_EVENT_CHANNELS = [
  'pr_merged', 'deploy_completed', 'incident_created',
  'ticket_created', 'connector_registered',
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      const kg = createKnowledgeGraph(event.tenantId as TenantId)
      const bootstrapRegistry = new Map<string, IConnectorBootstrap>()
      bootstrapRegistry.set('github', new GitHubBootstrap(kg, process.env['GH_TOKEN'] ?? ''))
      bootstrapRegistry.set('argocd', new ArgocdBootstrap(kg))
      bootstrapRegistry.set('datadog', new DatadogBootstrap(kg))
      bootstrapRegistry.set('linear', new LinearBootstrap(kg, process.env['LINEAR_API_KEY']))
      const agent = new GraphBuilderAgent(kg, provider, cheapModel, log, bootstrapRegistry, graphPub)
      await agent.handle(event)
    })
  }
  log.info({ channels: GRAPH_EVENT_CHANNELS }, 'GraphBuilderSubscriber started')
}
