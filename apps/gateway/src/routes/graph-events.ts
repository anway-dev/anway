import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import type { GraphEvent } from '@anvay/agent'
import { GraphBuilderAgent } from '@anvay/agent'
import { ProviderFactory } from '@anvay/agent'
import type { IModelProvider, ProviderConfig } from '@anvay/agent'
import type { TenantId } from '@anvay/types'
import { createKnowledgeGraph } from '../kb/index.js'
import { decryptJson } from '../utils/crypto.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

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

const KEYLESS_PROVIDERS = new Set(['ollama', 'lmstudio'])

async function tenantProviderFor(tenantId: string): Promise<IModelProvider | null> {
  try {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ provider: string; api_key_enc: string | null; base_url: string | null; default_model: string | null; cheap_model: string | null }>>`
        SELECT provider, api_key_enc, base_url, default_model, cheap_model
        FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    )
    if (rows.length > 0 && (rows[0]!.api_key_enc || KEYLESS_PROVIDERS.has(rows[0]!.provider))) {
      const r = rows[0]!
      return ProviderFactory.create({
        type: r.provider as ProviderConfig['type'],
        apiKey: r.api_key_enc ? decryptJson<string>(r.api_key_enc) : undefined,
        baseURL: r.base_url || undefined,
        defaultModel: r.default_model || undefined,
        cheapModel: r.cheap_model || undefined,
      })
    }
  } catch { /* fall back to env provider */ }
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

interface GraphEntityRow {
  id: string
  name: string
  type: string
  metadata: Record<string, unknown>
  updatedAt: string
}

interface GraphRelRow {
  fromEntityId: string
  relType: string
  toEntityId: string
}

interface TriageEntityRow {
  id: string
  type: string
  name: string
  metadata: Record<string, unknown>
}

interface TriageRelatedRow {
  relType: string
  id: string
  type: string
  name: string
  metadata: Record<string, unknown>
}

export async function graphEventRoutes(app: FastifyInstance) {
  // Knowledge graph explorer — entities + relationships for the tenant
  app.get('/api/graph/entities', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { cursor, limit: limitStr, exclude_types } = request.query as { cursor?: string; limit?: string; exclude_types?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)
    const excludedTypes = exclude_types ? exclude_types.split(',').map(t => t.trim()).filter(Boolean) : []
    return withTenant(prisma, tenantId, async (tx) => {
      const entities = await tx.$queryRaw<GraphEntityRow[]>`
        SELECT id, name, type, metadata, updated_at AS "updatedAt"
        FROM entities
        WHERE tenant_id = ${tenantId}::uuid
        ${cursor ? Prisma.sql`AND id > ${cursor}::uuid` : Prisma.sql``}
        ${excludedTypes.length > 0 ? Prisma.sql`AND type != ALL(${excludedTypes}::text[])` : Prisma.sql``}
        ORDER BY id ASC
        LIMIT ${limit + 1}
      `
      const hasMore = entities.length > limit
      const entityData = hasMore ? entities.slice(0, limit) : entities
      const relationships = await tx.$queryRaw<GraphRelRow[]>`
        SELECT from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId"
        FROM relationships WHERE tenant_id = ${tenantId}::uuid LIMIT 2000
      `
      return { data: entityData, relationships, nextCursor: hasMore ? entityData[entityData.length - 1]!.id : null }
    })
  })

  // Graph triage — resolve a primary entity by name and return its one-hop
  // neighbourhood (both outbound and inbound edges) grouped by relationship type.
  app.get<{ Params: { entityName: string } }>(
    '/api/graph/triage/:entityName',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const entityName = decodeURIComponent(request.params.entityName ?? '').trim()
      if (!entityName) {
        return reply.code(400).send({ error: 'entityName is required' })
      }

      return withTenant(prisma, tenantId, async (tx) => {
        const primaryRows = await tx.$queryRaw<TriageEntityRow[]>`
          SELECT id, type, name, metadata
          FROM entities
          WHERE tenant_id = ${tenantId}::uuid AND name = ${entityName}
          LIMIT 1
        `
        const primary = primaryRows[0]
        if (!primary) {
          return reply.code(404).send({ error: 'entity not found' })
        }

        // One-hop outbound: primary -[rel]-> neighbour
        const outbound = await tx.$queryRaw<TriageRelatedRow[]>`
          SELECT r.rel_type AS "relType", e.id, e.type, e.name, e.metadata
          FROM relationships r
          JOIN entities e ON e.id = r.to_entity_id
          WHERE r.from_entity_id = ${primary.id}::uuid
        `

        // One-hop inbound: neighbour -[rel]-> primary (e.g. Ticket OWNED_BY this)
        const inbound = await tx.$queryRaw<TriageRelatedRow[]>`
          SELECT r.rel_type AS "relType", e.id, e.type, e.name, e.metadata
          FROM relationships r
          JOIN entities e ON e.id = r.from_entity_id
          WHERE r.to_entity_id = ${primary.id}::uuid
        `

        const related: Record<string, Array<{ id: string; type: string; name: string }>> = {}
        const recentDeploys: Array<{ name: string; metadata: Record<string, unknown> }> = []

        for (const row of [...outbound, ...inbound]) {
          if (!related[row.relType]) related[row.relType] = []
          related[row.relType]!.push({ id: row.id, type: row.type, name: row.name })
          if (row.type === 'Deploy') {
            recentDeploys.push({ name: row.name, metadata: row.metadata ?? {} })
          }
        }

        return {
          entity: { id: primary.id, type: primary.type, name: primary.name, metadata: primary.metadata ?? {} },
          related,
          recentDeploys,
        }
      })
    },
  )

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
        // Return 401 (not 503) — don't reveal whether the endpoint is configured
        return reply.code(401).send({ error: 'unauthorized — connector API keys not configured' })
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

    // Tenant-selected provider (DB) wins; no fallback to shared env provider
    const tenantProvider = await tenantProviderFor(event.tenantId)
    if (!tenantProvider) {
      return reply.code(503).send({ error: 'GraphBuilderAgent not configured — no LLM provider' })
    }

    // KG is cheap — create per request so withTenant sets correct tenant_id GUC
    const kg = createKnowledgeGraph(event.tenantId as TenantId)
    const agent = new GraphBuilderAgent(kg, tenantProvider, app.log)

    try {
      await agent.handle(event)

      // For deploy_trigger: create a pipeline + pending gate so the UI surfaces the approval
      if (event.type === 'deploy_trigger') {
        const dt = event as import('@anvay/agent').DeployTrigger
        const pipelineName = `Deploy ${dt.service}:${dt.sha.slice(0, 7)} → ${dt.environment}`
        const stages = [
          { id: 'gate.deploy', name: '→ Deploy', icon: '⊡', color: '#f59e0b', type: 'gate', gate: true, env: null },
          { id: 'deploy', name: 'Deploy', icon: '▶', color: '#ef4444', type: 'deploy', gate: false, env: dt.environment, envLabel: dt.environment },
          { id: 'monitor', name: 'Monitor', icon: '◎', color: '#ef4444', type: 'monitor', gate: false, env: dt.environment, envLabel: dt.environment },
        ]
        const meta = JSON.stringify({
          service: dt.service,
          sha: dt.sha,
          imageUri: dt.imageUri,
          environment: dt.environment,
          triggeredBy: dt.triggeredBy,
          workflowRun: dt.workflowRun ?? null,
          commitMessage: dt.commitMessage ?? null,
          namespace: dt.environment === 'prod' ? 'demo' : `demo-${dt.environment}`,
          imageTag: dt.sha.slice(0, 7),
        })

        const pipelineRows = await withTenant(prisma, event.tenantId as TenantId, (tx) =>
          tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO pipelines (id, tenant_id, name, description, stages, status, metadata, created_at, updated_at)
            VALUES (gen_random_uuid(), ${event.tenantId}::uuid, ${pipelineName}, ${'Triggered by GitHub Actions'}, ${JSON.stringify(stages)}::jsonb, 'waiting', ${meta}::jsonb, now(), now())
            RETURNING id
          `
        ).catch(() => [] as Array<{ id: string }>)

        if (pipelineRows.length > 0) {
          const pipelineId = pipelineRows[0]!.id
          // Create waiting gate_run so the UI shows it as pending approval
          await withTenant(prisma, event.tenantId as TenantId, (tx) =>
            tx.$executeRaw`
              INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at)
              VALUES (gen_random_uuid(), ${pipelineId}::uuid, ${event.tenantId}::uuid, 'gate.deploy', 'waiting',
                ${JSON.stringify({ message: 'Awaiting approval to deploy', service: dt.service, sha: dt.sha, imageUri: dt.imageUri, triggeredBy: dt.triggeredBy })}::jsonb, now())
            `
          ).catch(() => null)

          await withTenant(prisma, event.tenantId as TenantId, (tx) =>
            tx.$executeRaw`
              INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, status, created_at)
              VALUES (gen_random_uuid(), ${event.tenantId}::uuid, '00000000-0000-0000-0000-000000000002'::uuid,
                '00000000-0000-0000-0000-000000000000'::uuid, ${'pipeline_deploy_gate'},
                ${JSON.stringify({ pipelineId, stageId: 'gate.deploy', service: dt.service, sha: dt.sha, triggeredBy: dt.triggeredBy })}::jsonb,
                'pending', now())
            `
          ).catch(() => null)

          return { ok: true, pipelineId }
        }
      }

      return { ok: true }
    } catch (err) {
      request.log.error({ err, eventType: event.type }, 'GraphBuilderAgent event handling failed')
      return reply.code(500).send({ error: 'internal error' })
    }
  })
}
