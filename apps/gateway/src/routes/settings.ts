import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import type { PrismaClient } from '@prisma/client'
import { providerRegistry } from '@anvay/agent'
import { encryptJson } from '../utils/crypto.js'
import { effectiveCredentials } from '../utils/credentials.js'
import { requireRole } from '../plugins/rbac.js'

function manifestModels(manifest: { models: string[] | 'dynamic'; modelsEndpoint?: string; defaultBaseUrl?: string }): string[] {
  if (Array.isArray(manifest.models)) return manifest.models
  return []  // dynamic models resolved client-side
}

function isSafeBaseUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (!['http:', 'https:'].includes(u.protocol)) return false
    const host = u.hostname.replace(/^\[|\]$/g, '')  // strip IPv6 brackets
    // Block RFC-1918 private ranges + loopback IPs. localhost blocked too — consistency with 127.0.0.1
    if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === 'localhost') return false
    // Block IPv4-mapped IPv6 loopback (e.g. http://[::ffff:127.0.0.1]/)
    if (host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:172.') || host.startsWith('::ffff:192.') || host.startsWith('::ffff:169.')) return false
    // Block decimal-encoded IPs (e.g. http://2130706433/ → 127.0.0.1)
    if (/^\d+$/.test(host)) return false
    if (/^(169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(host)) return false
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
      tx.$queryRaw<{ provider: string; default_model: string | null; cheap_model: string | null }[]>`
        SELECT provider, default_model AS default_model, cheap_model AS cheap_model FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    ).catch(() => [])
    if (config.length === 0) return { configured: false }
    return { configured: true, provider: config[0]!.provider, defaultModel: config[0]!.default_model, cheapModel: config[0]!.cheap_model }
  })

  const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'groq', 'deepseek', 'mistral', 'ollama', 'lmstudio'])

  app.post<{ Body: { provider: string; apiKey?: string; baseUrl?: string; defaultModel?: string; cheapModel?: string } }>(
    '/api/settings/provider', { preHandler: [app.authenticate] }, async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string }
      if (user.role !== 'admin') {
        return reply.code(403).send({ error: 'admin role required' })
      }
      const { provider, apiKey, baseUrl, defaultModel, cheapModel } = request.body
      if (!VALID_PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: `invalid provider: ${provider}. Valid: ${[...VALID_PROVIDERS].join(', ')}` })
      }
      const { tenantId } = user
      const apiKeyEnc = apiKey ? encryptJson(apiKey) : null
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO provider_config (tenant_id, provider, base_url, default_model, cheap_model, api_key_enc)
          VALUES (${tenantId}::uuid, ${provider}, ${baseUrl ?? null}, ${defaultModel ?? null}, ${cheapModel ?? null}, ${apiKeyEnc ?? null})
          ON CONFLICT (tenant_id)
          DO UPDATE SET provider = ${provider},
            base_url = COALESCE(${baseUrl ?? null}, provider_config.base_url),
            default_model = COALESCE(${defaultModel ?? null}, provider_config.default_model),
            cheap_model = COALESCE(${cheapModel ?? null}, provider_config.cheap_model),
            api_key_enc = COALESCE(${apiKeyEnc ?? null}, provider_config.api_key_enc),
            updated_at = NOW()
        `
      )
      return { ok: true }
    },
  )

  app.get('/api/settings/models', { preHandler: [app.authenticate] }, async (request) => {
    const p = (request.query as { provider?: string }).provider
    const baseUrl = (request.query as { baseUrl?: string }).baseUrl
    // apiKey sent via X-Api-Key header (not query string) to prevent SSRF via URL leak
    const apiKey = request.headers['x-api-key'] as string | undefined
    if (!p) return { models: [] }

    const manifest = providerRegistry.get(p)
    if (!manifest) return { models: [] }

    // Static model list
    if (Array.isArray(manifest.models)) return { models: manifest.models }

    // Dynamic: fetch from endpoint — SSRF-safe (validate full composed URL)
    const effectiveBaseUrl = baseUrl ?? manifest.defaultBaseUrl
    if (manifest.modelsEndpoint && effectiveBaseUrl) {
      const url = `${effectiveBaseUrl.replace(/\/$/, '')}/${manifest.modelsEndpoint.replace(/^\//, '')}`
      if (!isSafeBaseUrl(url)) return { models: [] }
      try {
        const headers: Record<string, string> = {}
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        const resp = await fetch(url, { headers })
        const data = await resp.json() as { models?: { name: string }[]; data?: { id: string }[] }
        // Handle both Ollama format ({ models: [{ name }] }) and OpenAI format ({ data: [{ id }] })
        if (data.models) return { models: data.models.map((m: { name: string }) => m.name) }
        if (data.data) return { models: data.data.map((m: { id: string }) => m.id) }
      } catch { /* fall through */ }
    }

    return { models: [] }
  })

  app.get('/api/settings/workspace', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ name: string }[]>`SELECT name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`
    ).catch(() => [])
    return { name: rows[0]?.name ?? 'Anvay' }
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

  const KNOWN_CONNECTORS = [
    'github', 'datadog', 'linear', 'argocd', 'coralogix', 'notion',
    'prometheus', 'newrelic', 'jira', 'loki', 'terraform', 'pagerduty',
    'slack', 'grafana', 'elastic', 'dynatrace', 'sentry', 'jenkins',
    'circleci', 'vercel', 'k8s', 'vault', 'snyk', 'sonarqube',
    'opsgenie', 'launchdarkly', 'confluence',
    'eks', 'gke', 'aws-cloudwatch', 'aws-health', 'gcp-monitoring', 'azure-monitor',
    'alertmanager',
  ]

  app.put<{ Params: { type: string }; Body: { credentials: Record<string, unknown> } }>(
    '/api/settings/connectors/:type', { preHandler: [app.authenticate, requireRole('admin')] }, async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { type } = request.params
      if (!KNOWN_CONNECTORS.includes(type)) {
        return reply.code(400).send({ error: 'Unknown connector type' })
      }
      const { credentials } = request.body

      // Check if this is a first registration vs credential update
      const existing = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM connector_config WHERE connector_type = ${type} AND tenant_id = ${tenantId}::uuid LIMIT 1`
      ).catch(() => [])
      const isNew = existing.length === 0

      // Credentials live only in credentials_enc — plaintext column dropped (S1.4).
      const credsEnc = encryptJson(credentials)
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO connector_config (tenant_id, connector_type, credentials_enc, enabled)
          VALUES (${tenantId}::uuid, ${type}, ${credsEnc}, true)
          ON CONFLICT (tenant_id, connector_type)
          DO UPDATE SET credentials_enc = ${credsEnc}, enabled = true, updated_at = NOW()
        `
      )

      // Emit connector_registered only on first registration (not credential update)
      if (isNew && opts?.pub) {
        const creds = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ credentials_enc: string | null; credentials: Record<string, unknown> }>>`
            SELECT credentials_enc FROM connector_config
            WHERE connector_type = ${type} AND tenant_id = ${tenantId}::uuid LIMIT 1
          `
        ).catch(() => [])
        const credPayload = effectiveCredentials(creds[0])
        await opts.pub.publish('connector_registered', JSON.stringify({
          type: 'connector_registered',
          tenantId,
          connectorType: type,
          connectorId: type,
          payload: credPayload,
        }))
      }

      return { ok: true }
    },
  )
}

