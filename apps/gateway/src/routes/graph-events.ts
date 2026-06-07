import type { FastifyInstance } from 'fastify'
import type { GraphEvent } from '@anvay/agent'
import { GraphBuilderAgent } from '@anvay/agent'
import { ProviderFactory } from '@anvay/agent'
import type { IModelProvider, ProviderConfig } from '@anvay/agent'
import type { TenantId } from '@anvay/types'
import { createKnowledgeGraph } from '../kb/index.js'

const CONNECTOR_API_KEYS = new Set(
  (process.env['CONNECTOR_API_KEYS'] ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
)

function resolveGraphBuilderProvider(): IModelProvider | null {
  const providerOrder: ProviderConfig['type'][] = ['anthropic', 'openai', 'groq', 'mistral', 'ollama', 'lmstudio']
  for (const type of providerOrder) {
    const config = providerConfigFromEnv(type)
    if (config) return ProviderFactory.create(config)
  }
  return null
}

function providerConfigFromEnv(type: ProviderConfig['type']): ProviderConfig | null {
  if (type === 'anthropic' && process.env['ANTHROPIC_API_KEY']) {
    return { type: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] }
  }
  if (type === 'openai' && process.env['OPENAI_API_KEY']) {
    return { type: 'openai', apiKey: process.env['OPENAI_API_KEY'] }
  }
  if (type === 'groq' && process.env['GROQ_API_KEY']) {
    return { type: 'groq', apiKey: process.env['GROQ_API_KEY'] }
  }
  if (type === 'mistral' && process.env['MISTRAL_API_KEY']) {
    return { type: 'mistral', apiKey: process.env['MISTRAL_API_KEY'] }
  }
  if (type === 'ollama' && process.env['OLLAMA_ENDPOINT']) {
    return { type: 'ollama', baseURL: process.env['OLLAMA_ENDPOINT'] }
  }
  if (type === 'lmstudio' && process.env['LMSTUDIO_ENDPOINT']) {
    return { type: 'lmstudio', baseURL: process.env['LMSTUDIO_ENDPOINT'] }
  }
  return null
}

export async function graphEventRoutes(app: FastifyInstance) {
  // Provider is a module-level singleton (expensive to build — auth clients cached inside)
  const provider = resolveGraphBuilderProvider()
  if (!provider) {
    app.log.warn('GraphBuilderAgent: no LLM provider configured — extraction disabled')
  }

  app.post<{ Body: GraphEvent }>('/api/graph/events', {
    preHandler: async (request, reply) => {
      // Connector API key auth — not user JWT
      const key = request.headers['x-connector-key']
      if (!key || (CONNECTOR_API_KEYS.size > 0 && !CONNECTOR_API_KEYS.has(key as string))) {
        return reply.code(401).send({ error: 'unauthorized — missing or invalid x-connector-key' })
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['type', 'tenantId'],
        properties: {
          type: { type: 'string' },
          tenantId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const event = request.body

    if (!provider) {
      return reply.code(503).send({ error: 'GraphBuilderAgent not configured — no LLM provider' })
    }

    // KG is cheap — create per request so withTenant sets correct tenant_id GUC
    const kg = createKnowledgeGraph(event.tenantId as TenantId)
    const agent = new GraphBuilderAgent(kg, provider, 'claude-haiku-3-5-20251001', app.log)

    try {
      await agent.handle(event)
      return { ok: true }
    } catch (err) {
      request.log.error({ err, eventType: event.type }, 'GraphBuilderAgent event handling failed')
      return reply.code(500).send({
        error: err instanceof Error ? err.message : 'graph event processing failed',
      })
    }
  })
}
