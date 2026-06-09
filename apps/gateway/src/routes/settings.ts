import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import type { PrismaClient } from '@prisma/client'

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o1'],
  deepseek: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
  ollama: [],
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/provider', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const config = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ provider: string; default_model: string | null }[]>`
        SELECT provider, default_model AS default_model FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    ).catch(() => [])
    if (config.length === 0) return { configured: false }
    return { configured: true, provider: config[0]!.provider, defaultModel: config[0]!.default_model }
  })

  app.post<{ Body: { provider: string; apiKey?: string; baseUrl?: string; defaultModel?: string } }>(
    '/api/settings/provider', { preHandler: [app.authenticate] }, async (request) => {
      const { tenantId } = request.user as { tenantId: string }
      const { provider, apiKey, baseUrl, defaultModel } = request.body
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO provider_config (tenant_id, provider, api_key, base_url, default_model)
          VALUES (${tenantId}::uuid, ${provider}, ${apiKey ?? null}, ${baseUrl ?? null}, ${defaultModel ?? null})
          ON CONFLICT (tenant_id)
          DO UPDATE SET provider = ${provider}, api_key = ${apiKey ?? null}, base_url = ${baseUrl ?? null},
            default_model = ${defaultModel ?? null}, updated_at = NOW()
        `
      )
      return { ok: true }
    },
  )

  app.get('/api/settings/models', async (request) => {
    const provider = (request.query as { provider?: string }).provider
    const baseUrl = (request.query as { baseUrl?: string }).baseUrl
    if (!provider) return { models: [] }

    // Ollama: dynamic from endpoint
    if (provider === 'ollama' && baseUrl) {
      try {
        const resp = await fetch(`${baseUrl}/api/tags`)
        const data = await resp.json() as { models?: { name: string }[] }
        return { models: (data.models ?? []).map((m: { name: string }) => m.name) }
      } catch {
        return { models: [] }
      }
    }

    // OpenAI with DeepSeek base URL → deepseek models
    if (provider === 'openai' && baseUrl?.includes('deepseek.com')) {
      return { models: PROVIDER_MODELS['deepseek'] ?? [] }
    }

    return { models: PROVIDER_MODELS[provider] ?? [] }
  })

  app.get('/api/settings/connectors', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const configs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_type: string; enabled: boolean; bootstrapped_at: Date | null }[]>`
        SELECT connector_type AS connector_type, enabled, bootstrapped_at
        FROM connector_config WHERE tenant_id = ${tenantId}::uuid ORDER BY connector_type
      `
    ).catch(() => [])
    return configs.map(c => ({ connectorType: c.connector_type, enabled: c.enabled, bootstrappedAt: c.bootstrapped_at }))
  })

  app.put<{ Params: { type: string }; Body: { credentials: Record<string, unknown> } }>(
    '/api/settings/connectors/:type', { preHandler: [app.authenticate] }, async (request) => {
      const { tenantId } = request.user as { tenantId: string }
      const { type } = request.params
      const { credentials } = request.body
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO connector_config (tenant_id, connector_type, credentials, enabled)
          VALUES (${tenantId}::uuid, ${type}, ${JSON.stringify(credentials)}::jsonb, true)
          ON CONFLICT (tenant_id, connector_type)
          DO UPDATE SET credentials = ${JSON.stringify(credentials)}::jsonb, enabled = true, updated_at = NOW()
        `
      )

      // Emit connector_registered event for graph builder
      const pub = await getPub()
      if (pub) {
        await pub.publish('connector_registered', JSON.stringify({ tenantId, connectorType: type }))
      }

      return { ok: true }
    },
  )
}

let _pub: import('redis').RedisClientType | null = null

async function getPub(): Promise<import('redis').RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (!_pub) {
    const { createClient } = await import('redis')
    _pub = createClient({ url }) as import('redis').RedisClientType
    await _pub.connect()
  }
  return _pub
}
