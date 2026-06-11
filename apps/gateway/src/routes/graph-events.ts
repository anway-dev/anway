import type { FastifyInstance } from 'fastify'
import type { GraphEvent } from '@anvay/agent'
import { GraphBuilderAgent } from '@anvay/agent'
import { ProviderFactory } from '@anvay/agent'
import type { IModelProvider, ProviderConfig } from '@anvay/agent'
import type { TenantId } from '@anvay/types'
import { createKnowledgeGraph } from '../kb/index.js'

// CONNECTOR_API_KEYS format: <key>:<tenantId>,<key>:<tenantId>,...
// Each key is bound to exactly one tenant — cross-tenant writes are rejected.
const CONNECTOR_KEY_TENANT_MAP = new Map<string, string>()
for (const entry of (process.env['CONNECTOR_API_KEYS'] ?? '').split(',').map(k => k.trim()).filter(Boolean)) {
  const colonIdx = entry.indexOf(':')
  if (colonIdx > 0) {
    CONNECTOR_KEY_TENANT_MAP.set(entry.slice(0, colonIdx), entry.slice(colonIdx + 1))
  }
}
const VALID_API_KEYS = new Set([...CONNECTOR_KEY_TENANT_MAP.keys()].filter(k => k.length > 0))

function warnIfNoKeys(app: FastifyInstance): void {
  if (CONNECTOR_KEY_TENANT_MAP.size === 0) {
    app.log.warn('CONNECTOR_API_KEYS not set — /api/graph/events is unauthenticated. Set this in production.')
  }
}

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

  // Guard: warn at startup if no keys configured
  warnIfNoKeys(app)

  app.post<{ Body: GraphEvent }>('/api/graph/events', {
    preHandler: async (request, reply) => {
      if (VALID_API_KEYS.size === 0) {
        return reply.code(503).send({ error: 'connector API keys not configured' })
      }
      const key = request.headers['x-connector-key'] as string | undefined
      if (!key || !VALID_API_KEYS.has(key)) {
        return reply.code(401).send({ error: 'unauthorized — missing or invalid x-connector-key' })
      }
      // Validate tenant binding immediately
      const boundTenant = CONNECTOR_KEY_TENANT_MAP.get(key)
      if (!boundTenant) {
        return reply.code(401).send({ error: 'unauthorized — key has no tenant binding' })
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
    const apiKey = request.headers['x-connector-key'] as string
    const boundTenant = CONNECTOR_KEY_TENANT_MAP.get(apiKey)!

    // Enforce tenant binding — key can only write to its bound tenant
    if (event.tenantId !== boundTenant) {
      return reply.code(403).send({ error: 'forbidden — API key is not authorized for this tenantId' })
    }

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
