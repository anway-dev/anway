import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import type { PrismaClient } from '@prisma/client'
import { providerRegistry } from '@anvay/agent'

function manifestModels(manifest: { models: string[] | 'dynamic'; modelsEndpoint?: string; defaultBaseUrl?: string }): string[] {
  if (Array.isArray(manifest.models)) return manifest.models
  return []  // dynamic models resolved client-side
}

function isSafeBaseUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (!['http:', 'https:'].includes(u.protocol)) return false
    // Block cloud metadata + RFC-1918 private ranges — allow localhost for Ollama dev
    if (/^(169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(u.hostname)) return false
    return true
  } catch { return false }
}

export async function settingsRoutes(app: FastifyInstance, opts?: { pub?: import('redis').RedisClientType }) {
  app.get('/api/settings/provider-manifests', async () => {
    const manifests = providerRegistry.list()
    return manifests.map(m => ({
      id: m.id,
      displayName: m.displayName,
      website: m.website,
      fields: m.fields,
      models: manifestModels(m),
      modelsEndpoint: m.modelsEndpoint,
      defaultBaseUrl: m.defaultBaseUrl,
      openAICompatible: m.openAICompatible,
    }))
  })
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
    const p = (request.query as { provider?: string }).provider
    const baseUrl = (request.query as { baseUrl?: string }).baseUrl
    if (!p) return { models: [] }

    const manifest = providerRegistry.get(p)
    if (!manifest) return { models: [] }

    // Static model list
    if (Array.isArray(manifest.models)) return { models: manifest.models }

    // Dynamic: fetch from endpoint — SSRF-safe (block cloud metadata, allow localhost for Ollama)
    if (manifest.modelsEndpoint && baseUrl && isSafeBaseUrl(baseUrl)) {
      try {
        const url = `${baseUrl.replace(/\/$/, '')}/${manifest.modelsEndpoint.replace(/^\//, '')}`
        const resp = await fetch(url)
        const data = await resp.json() as { models?: { name: string }[]; data?: { id: string }[] }
        // Handle both Ollama format ({ models: [{ name }] }) and OpenAI format ({ data: [{ id }] })
        if (data.models) return { models: data.models.map((m: { name: string }) => m.name) }
        if (data.data) return { models: data.data.map((m: { id: string }) => m.id) }
      } catch { /* fall through */ }
    }

    return { models: [] }
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

  const KNOWN_CONNECTORS = ['github', 'datadog', 'linear', 'argocd', 'k8s', 'pagerduty', 'slack']

  app.put<{ Params: { type: string }; Body: { credentials: Record<string, unknown> } }>(
    '/api/settings/connectors/:type', { preHandler: [app.authenticate] }, async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { type } = request.params
      if (!KNOWN_CONNECTORS.includes(type)) {
        return reply.code(400).send({ error: 'Unknown connector type' })
      }
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
      if (opts?.pub) {
        await opts.pub.publish('connector_registered', JSON.stringify({ tenantId, connectorType: type }))
      }

      return { ok: true }
    },
  )
}

