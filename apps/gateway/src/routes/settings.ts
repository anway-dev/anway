import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { createClient } from 'redis'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import type { PrismaClient } from '@prisma/client'
import { providerRegistry } from '@anway/agent'
import { encryptJson, decryptJson } from '../utils/crypto.js'
import { requireRole, auditAndDenyIfNotAdmin } from '../plugins/rbac.js'
import { publishDurable } from '../events/durable-events.js'
import { isSafeURL } from '../utils/safe-url.js'
import { CONNECTOR_CATALOG } from './connectors.js'

let _settingsPub: import('redis').RedisClientType | null = null
let _settingsPubPromise: Promise<import('redis').RedisClientType> | null = null

async function getSettingsPub(): Promise<import('redis').RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (_settingsPub) return _settingsPub
  if (!_settingsPubPromise) {
    _settingsPubPromise = (async () => {
      const client = createClient({ url }) as import('redis').RedisClientType
      await client.connect()
      _settingsPub = client
      return client
    })().catch(() => { _settingsPubPromise = null; return null as unknown as import('redis').RedisClientType })
  }
  return _settingsPubPromise
}

function manifestModels(manifest: { models: string[] | 'dynamic'; modelsEndpoint?: string; defaultBaseUrl?: string }): string[] {
  if (Array.isArray(manifest.models)) return manifest.models
  return []  // dynamic models resolved client-side
}

// isSafeBaseUrl/isSafeURL moved to ../utils/safe-url.ts — shared with
// connectors.ts's /api/connectors/:type/test route, which previously had no
// SSRF guard at all.

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
      if (await auditAndDenyIfNotAdmin(request, reply)) return
      const { provider, apiKey, baseUrl, defaultModel, cheapModel } = request.body
      if (!VALID_PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: `invalid provider: ${provider}. Valid: ${[...VALID_PROVIDERS].join(', ')}` })
      }
      const { tenantId } = user
      // When apiKey is explicitly provided (even empty), set/clear the key.
      // When omitted (undefined), preserve existing key via COALESCE.
      const apiKeyEnc = apiKey !== undefined ? (apiKey ? encryptJson(apiKey) : null) : null
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO provider_config (tenant_id, provider, base_url, default_model, cheap_model, api_key_enc)
          VALUES (${tenantId}::uuid, ${provider}, ${baseUrl ?? null}, ${defaultModel ?? null}, ${cheapModel ?? null}, ${apiKeyEnc})
          ON CONFLICT (tenant_id)
          DO UPDATE SET provider = ${provider},
            base_url = COALESCE(${baseUrl ?? null}, provider_config.base_url),
            default_model = COALESCE(${defaultModel ?? null}, provider_config.default_model),
            cheap_model = COALESCE(${cheapModel ?? null}, provider_config.cheap_model),
            api_key_enc = ${apiKey !== undefined ? Prisma.sql`${apiKeyEnc}` : Prisma.sql`provider_config.api_key_enc`},
            updated_at = NOW()
        `
      )
      return { ok: true }
    },
  )

  app.get('/api/settings/models', { preHandler: [app.authenticate, requireRole('admin')] }, async (request, reply) => {
    const user = request.user as { role?: string; tenantId?: string }
    const p = (request.query as { provider?: string }).provider
    const baseUrl = (request.query as { baseUrl?: string }).baseUrl
    // apiKey sent via X-Api-Key header (not query string) to prevent SSRF via URL leak
    let apiKey = request.headers['x-api-key'] as string | undefined
    if (!p) return { models: [] }

    const manifest = providerRegistry.get(p)
    if (!manifest) return { models: [] }

    // Editing an already-configured provider: the browser has no plaintext key
    // (it's never returned for security), so the model-list call would arrive
    // keyless and every dynamic-model provider (deepseek/openai/groq/…) 401s →
    // empty list → the Model / Cheap-model dropdowns never render. Found in
    // manual testing. Fall back to the tenant's STORED key for THIS provider.
    if (!apiKey && user.tenantId) {
      const stored = await withTenant(prisma, user.tenantId, (tx) =>
        tx.$queryRaw<{ api_key_enc: string | null }[]>`
          SELECT api_key_enc FROM provider_config
          WHERE tenant_id = ${user.tenantId}::uuid AND provider = ${p} LIMIT 1
        `
      ).catch(() => [])
      const enc = stored[0]?.api_key_enc
      if (enc) { try { apiKey = decryptJson<string>(enc) } catch { /* ignore */ } }
    }

    // Static model list
    if (Array.isArray(manifest.models)) return { models: manifest.models }

    // Dynamic: fetch from endpoint — SSRF-safe (validate full composed URL + DNS-rebind protection)
    const effectiveBaseUrl = baseUrl ?? manifest.defaultBaseUrl
    if (manifest.modelsEndpoint && effectiveBaseUrl) {
      const url = `${effectiveBaseUrl.replace(/\/$/, '')}/${manifest.modelsEndpoint.replace(/^\//, '')}`
      if (!await isSafeURL(url)) return { models: [] }
      try {
        const headers: Record<string, string> = {}
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        const resp = await fetch(url, { headers, redirect: 'manual' })
        if (resp.status >= 300 && resp.status < 400) return { models: [] }
        const data = await resp.json() as { models?: { name: string }[]; data?: { id: string }[] }
        // Handle both Ollama format ({ models: [{ name }] }) and OpenAI format ({ data: [{ id }] })
        if (data.models) return { models: data.models.map((m: { name: string }) => m.name) }
        if (data.data) return { models: data.data.map((m: { id: string }) => m.id) }
      } catch { /* fall through */ }
    }

    // Dynamic fetch produced nothing (no/invalid key, endpoint unreachable).
    // Do NOT fabricate a model list — return empty with a reason so the UI
    // shows an honest "couldn't load models, check your API key" state rather
    // than assuming model names the vendor may have renamed/deprecated.
    return { models: [], error: 'could not fetch models from the provider — verify the API key and that the provider is reachable' }
  })

  app.get('/api/settings/workspace', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ name: string }[]>`SELECT name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`
    ).catch(() => [])
    return { name: rows[0]?.name ?? 'Anway' }
  })

  app.get('/api/settings/connectors', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const configs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_type: string; instance_name: string; enabled: boolean; bootstrapped_at: Date | null }[]>`
        SELECT connector_type AS connector_type, instance_name, enabled, bootstrapped_at
        FROM connector_config WHERE tenant_id = ${tenantId}::uuid ORDER BY connector_type, instance_name
      `
    ).catch(() => [])
    // instanceName included so multiple mcp/cli rows of the same type are
    // individually identifiable in the list, not indistinguishable duplicates.
    return configs.map(c => ({ connectorType: c.connector_type, instanceName: c.instance_name, enabled: c.enabled, bootstrappedAt: c.bootstrapped_at }))
  })

  const KNOWN_CONNECTORS = [
    'github', 'datadog', 'linear', 'argocd', 'coralogix', 'notion',
    'prometheus', 'newrelic', 'jira', 'loki', 'terraform', 'pagerduty',
    'slack', 'grafana', 'elastic', 'dynatrace', 'sentry', 'jenkins',
    'circleci', 'vercel', 'k8s', 'vault', 'snyk', 'sonarqube',
    'opsgenie', 'launchdarkly', 'confluence',
    'eks', 'gke', 'aks', 'aws-cloudwatch', 'aws-health', 'gcp-monitoring', 'azure-monitor',
    'alertmanager',
    // mcp/cli are NOT registered here — they're multi-instance templates
    // registered via the register_connector chat tool (apps/gateway/src/
    // connectors/registry.ts), which stores them in the `connectors` table,
    // not connector_config. This route/table is for singleton native
    // connectors only.
  ]

  app.get<{ Params: { type: string }; Querystring: { instanceName?: string } }>(
    '/api/settings/connectors/:type', { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { type } = request.params
      // instanceName required to disambiguate for multi-instance types
      // (mcp/cli); defaults to type for singleton connectors, matching
      // their instance_name = connector_type backfill.
      const instanceName = request.query.instanceName?.trim() || type
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ credentials_enc: string }>>`
          SELECT credentials_enc FROM connector_config
          WHERE connector_type = ${type} AND instance_name = ${instanceName} AND tenant_id = ${tenantId}::uuid AND enabled = true LIMIT 1
        `
      ).catch(() => [])
      if (rows.length === 0) return reply.code(404).send({ error: 'not configured' })
      const creds = decryptJson<Record<string, unknown>>(rows[0]!.credentials_enc)
      const catalogEntry = CONNECTOR_CATALOG.find(c => c.id === type)
      // 'textarea' fields (kubeconfig, GCP service-account JSON) are just as
      // sensitive as password/secret fields — confirmed live via independent
      // review every textarea field in the whole catalog is one of these two
      // credential types, none benign, and they were slipping through this
      // filter and getting returned in plaintext to any client that GETs
      // these connector credentials.
      const sensitiveKeys = new Set(
        (catalogEntry?.configFields ?? [])
          .filter(f => f.type === 'password' || f.type === 'secret' || f.type === 'textarea')
          .map(f => f.key)
      )
      const safe: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(creds)) {
        if (!sensitiveKeys.has(k)) safe[k] = v
      }
      return { credentials: safe }
    }
  )

  // instanceName lets a caller target a specific instance_name row for a
  // connector_type where one might exist (defaults to the type itself,
  // preserving the one-row-per-type behavior every native connector still
  // has). mcp/cli are excluded from KNOWN_CONNECTORS above — they're
  // multi-instance templates registered via register_connector instead,
  // into the separate `connectors` table.
  app.put<{ Params: { type: string }; Body: { credentials: Record<string, unknown>; instanceName?: string } }>(
    '/api/settings/connectors/:type', { preHandler: [app.authenticate, requireRole('admin')] }, async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { type } = request.params
      if (!KNOWN_CONNECTORS.includes(type)) {
        return reply.code(400).send({ error: 'Unknown connector type' })
      }
      const { credentials, instanceName: rawInstanceName } = request.body
      const instanceName = rawInstanceName?.trim() || type

      // Check if this is a first registration vs credential update
      const existing = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM connector_config WHERE connector_type = ${type} AND instance_name = ${instanceName} AND tenant_id = ${tenantId}::uuid LIMIT 1`
      ).catch(() => [])
      const isNew = existing.length === 0

      // Credentials live only in credentials_enc — plaintext column dropped (S1.4).
      const credsEnc = encryptJson(credentials)
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO connector_config (tenant_id, connector_type, instance_name, credentials_enc, enabled, env_id)
          VALUES (${tenantId}::uuid, ${type}, ${instanceName}, ${credsEnc}, true, NULL)
          ON CONFLICT (tenant_id, connector_type, instance_name, COALESCE(env_id, '00000000-0000-0000-0000-000000000000'::uuid))
          DO UPDATE SET credentials_enc = ${credsEnc}, enabled = true, updated_at = NOW()
        `
      )

      const pub = await getSettingsPub().catch(() => null)
      if (pub) {
        const row = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM connector_config
            WHERE connector_type = ${type} AND instance_name = ${instanceName} AND tenant_id = ${tenantId}::uuid LIMIT 1
          `
        ).catch(() => [])
        // connectorId is the connector_config row's own UUID — not the bare
        // type string — so multiple instances of the same type are properly
        // distinguished downstream (bootstrap registry, graph entities,
        // audit log). Confirmed live: the old `connectorId: type` pattern
        // was the other half of why only one instance per type ever worked.
        const connectorId = row[0]?.id ?? type
        // First registration → full bootstrap; credential update → reconnect (re-bootstrap with updated creds)
        const eventType = isNew ? 'connector_registered' : 'connector_reconnected'
        await pub.del(`graph:bootstrap:lock:${tenantId}:${connectorId}`).catch(() => {})
        // Payload deliberately OMITTED (previously carried decrypted
        // credentials through Redis): this publish is now durable — the
        // outbox writes the payload to event_log, and plaintext credentials
        // must never land in a Postgres table. The graph-builder subscriber
        // already has an explicit empty-payload path that loads the stored
        // encrypted credentials from connector_config by connectorId
        // (subscriber.ts's "carry no payload — load stored credentials"
        // branch), so dropping them here changes transport, not behavior.
        await publishDurable(pub, tenantId, eventType, {
          type: eventType,
          tenantId,
          connectorType: type,
          connectorId,
        })
      }

      return { ok: true }
    },
  )

  // GET /api/settings/token-usage — per-tenant monthly token budget
  app.get('/api/settings/token-usage', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const month = new Date().toISOString().slice(0, 7)
    // Always sum Postgres for authoritative total — Redis may drift
    let used = 0
    try {
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ monthly: bigint }>>`
          SELECT COALESCE(SUM(tokens_used), 0) AS monthly
          FROM token_usage_daily WHERE tenant_id = ${tenantId}::uuid
          AND date >= ${`${month}-01`}::date
        `
      ).catch(() => [])
      used = rows.length > 0 ? Number(rows[0]!.monthly) : 0
    } catch { /* table may not exist */ }
    // Also check Redis for near-real-time counter (not yet flushed to Postgres)
    let redisUsed = 0
    const redisUrl = process.env['REDIS_URL']
    if (redisUrl) {
      try {
        const { createClient } = await import('redis')
        const r = createClient({ url: redisUrl })
        await r.connect()
        const monthKey = `tokens:${tenantId}:${month}`
        redisUsed = parseInt(await r.get(monthKey) ?? '0', 10)
        await r.quit()
      } catch { /* Redis unavailable */ }
    }
    if (redisUsed > used) used = redisUsed
    // Get budget from tenant — null means unlimited
    let budget: number | null = null
    try {
      const tenantRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ token_budget_monthly: number | null }>>`
          SELECT token_budget_monthly FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `
      ).catch(() => [] as Array<{ token_budget_monthly: number | null }>)
      if (tenantRows.length > 0) {
        budget = tenantRows[0]!.token_budget_monthly ?? null
      }
    } catch { /* use default */ }
    return { used, budget, month }
  })

  // GET /api/settings/token-limits — return all configurable token limits for the tenant
  app.get('/api/settings/token-limits', { preHandler: [app.authenticate, requireRole('admin')] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ token_budget_monthly: number; per_query_token_limit: number | null; per_session_token_limit: number | null }[]>`
        SELECT token_budget_monthly, per_query_token_limit, per_session_token_limit
        FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
      `
    ).catch(() => [])
    const row = rows[0]
    return {
      monthlyBudget: row?.token_budget_monthly ?? 1_000_000,
      perQueryLimit: row?.per_query_token_limit ?? null,
      perSessionLimit: row?.per_session_token_limit ?? null,
    }
  })

  // PUT /api/settings/token-limits — update token limits; null = unlimited
  app.put<{ Body: { monthlyBudget?: number | null; perQueryLimit?: number | null; perSessionLimit?: number | null } }>(
    '/api/settings/token-limits', { preHandler: [app.authenticate, requireRole('admin')] }, async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const body = request.body
      if (body.monthlyBudget !== undefined && body.monthlyBudget !== null && body.monthlyBudget <= 0) {
        return reply.code(400).send({ error: 'monthlyBudget must be positive' })
      }
      if (body.monthlyBudget !== undefined) {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`UPDATE tenants SET token_budget_monthly = ${body.monthlyBudget} WHERE id = ${tenantId}::uuid`
        )
      }
      if ('perQueryLimit' in body) {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`UPDATE tenants SET per_query_token_limit = ${body.perQueryLimit ?? null} WHERE id = ${tenantId}::uuid`
        )
      }
      if ('perSessionLimit' in body) {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`UPDATE tenants SET per_session_token_limit = ${body.perSessionLimit ?? null} WHERE id = ${tenantId}::uuid`
        )
      }
      return { ok: true }
    },
  )

  // TB-T1: Admin reset daily token usage
  app.delete('/api/admin/token-usage/reset', {
    preHandler: [app.authenticate, requireRole('admin')],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const today = new Date().toISOString().slice(0, 10)
    const result = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        DELETE FROM token_usage_daily
        WHERE tenant_id = ${tenantId}::uuid AND date = ${today}::date
      `
    ).catch(() => 0)
    return reply.send({ deleted: result, date: today })
  })
}

