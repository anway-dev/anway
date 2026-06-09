import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import {
  createOrchestrator,
  runSession,
  ProviderFactory,
  AgentPerimeter,
  RedisSessionMemory,
  MemoryFactory,
} from '@anvay/agent'
import type {
  UserPerimeter,
  ConnectorManifest,
  ConnectorScope,
  TokenBudget,
  ISessionMemory,
  SessionMeta,
  ConversationTurn,
  SessionContext,
} from '@anvay/agent'
import type { ProviderConfig } from '@anvay/agent'
import { TenantId, UserId, SessionId } from '@anvay/types'
import type { AgentRole } from '@anvay/types'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '../db/client.js'
import { StructuralGraph } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import { PostgresAuditSink } from '../audit/postgres-sink.js'
import { withTenant } from '../db/prisma.js'
import { getToolsForTenant } from '../connectors/registry.js'
import { makeRegistrationTools } from '../connectors/registration-tools.js'
import { RedisGateSink } from '../gate/redis-gate-sink.js'

type ClientModelConfig = Pick<ProviderConfig, 'type' | 'defaultModel'>

interface ChatBody {
  query: string
  sessionId: string
  model?: ClientModelConfig
}

// In-process session memory — no cross-process persistence.
// Used when REDIS_URL is not configured. Suitable for dev and single-instance deploys.
export class InMemorySessionMemory implements ISessionMemory {
  private readonly turns = new Map<string, ConversationTurn[]>()
  private readonly metas = new Map<string, SessionMeta>()

  async get(sessionId: SessionId): Promise<SessionContext | null> {
    const stored = this.turns.get(sessionId)
    const meta = this.metas.get(sessionId)
    if (!stored) return null
    return {
      sessionId,
      userId: meta?.userId ?? UserId('unknown'),
      tenantId: meta?.tenantId ?? TenantId('unknown'),
      effectiveRole: meta?.effectiveRole ?? ('dev' as AgentRole),
      turns: stored,
    }
  }

  async initSession(meta: SessionMeta): Promise<void> {
    this.metas.set(meta.sessionId, meta)
  }

  async append(sessionId: SessionId, turn: ConversationTurn): Promise<void> {
    const existing = this.turns.get(sessionId) ?? []
    this.turns.set(sessionId, [...existing, turn])
  }

  async summarise(_sessionId: SessionId): Promise<void> {}

  async clear(sessionId: SessionId): Promise<void> {
    this.turns.delete(sessionId)
    this.metas.delete(sessionId)
  }
}

export function providerConfigFromEnv(type: string): ProviderConfig | null {
  if (type === 'anthropic' && process.env['ANTHROPIC_API_KEY']) {
    return { type: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] }
  }
  if (type === 'openai' && process.env['OPENAI_API_KEY']) {
    return {
      type: 'openai',
      apiKey: process.env['OPENAI_API_KEY'],
      ...(process.env['OPENAI_BASE_URL'] ? { baseURL: process.env['OPENAI_BASE_URL'] } : {}),
    }
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
  if (type === 'deepseek' && process.env['DEEPSEEK_API_KEY']) {
    return { type: 'deepseek', apiKey: process.env['DEEPSEEK_API_KEY'], baseURL: 'https://api.deepseek.com' }
  }
  return null
}

async function providerConfigForTenant(
  tenantId: string,
  client: PrismaClient,
): Promise<ProviderConfig | null> {
  const row = await withTenant(client, tenantId, (tx) =>
    tx.$queryRaw<{ provider: string; api_key: string | null; base_url: string | null; default_model: string | null }[]>`
      SELECT provider, api_key, base_url, default_model FROM provider_config WHERE tenant_id = ${tenantId}::uuid
    `
  ).catch(() => [])
  if (row.length > 0 && row[0]!.api_key) {
    const r = row[0]!
    return {
      type: r.provider as ProviderConfig['type'],
      apiKey: r.api_key!,
      ...(r.base_url ? { baseURL: r.base_url } : {}),
      ...(r.default_model ? { defaultModel: r.default_model } : {}),
    }
  }
  return null  // fallback to env-based config
}

function withDefaultModel(config: ProviderConfig, defaultModel?: string): ProviderConfig {
  return defaultModel ? { ...config, defaultModel } : config
}

export function resolveProviderConfig(override?: ClientModelConfig): ProviderConfig | null {
  if (override) {
    const config = providerConfigFromEnv(override.type)
    return config ? withDefaultModel(config, override.defaultModel) : null
  }

  const providerOrder: string[] = ['anthropic', 'openai', 'deepseek', 'groq', 'mistral', 'ollama', 'lmstudio']
  for (const type of providerOrder) {
    const config = providerConfigFromEnv(type)
    if (config) return config
  }
  return null
}

function buildTokenBudget(monthlyLimit = 1_000_000, sessionUsed = 0): TokenBudget {
  return {
    perQueryHardLimit: 100_000,
    perSessionLimit: 500_000,
    perTenantDailyLimit: Math.ceil(monthlyLimit / 30),
    perTenantMonthlyLimit: monthlyLimit,
    sessionUsed,
    tenantDailyUsed: 0,
    tenantMonthlyUsed: 0,
  }
}

// Module-level session token usage tracking (clears on process restart — acceptable for V1)
const sessionTokenUsage = new Map<string, { used: number; lastSeen: number }>()
const SESSION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function getSessionUsed(sessionId: string): number {
  const entry = sessionTokenUsage.get(sessionId)
  if (!entry) return 0
  if (Date.now() - entry.lastSeen > SESSION_TOKEN_TTL_MS) {
    sessionTokenUsage.delete(sessionId)
    return 0
  }
  return entry.used
}

function recordSessionUsed(sessionId: string, tokens: number): void {
  const prev = getSessionUsed(sessionId)
  sessionTokenUsage.set(sessionId, { used: prev + tokens, lastSeen: Date.now() })
}

// Module-level singletons — one per gateway process
const inMemoryStore = new InMemorySessionMemory()

export async function chatRoutes(app: FastifyInstance) {
  // Production requires Redis — in-memory is dev-only
  if (process.env['NODE_ENV'] === 'production' && !process.env['REDIS_URL']) {
    throw new Error('Production requires REDIS_URL environment variable')
  }

  // Build session memory — Redis if REDIS_URL configured, in-process fallback otherwise
  let sessionMemory: ISessionMemory = inMemoryStore

  const redisUrl = process.env['REDIS_URL']
  if (redisUrl) {
    try {
      sessionMemory = MemoryFactory.create({ type: 'redis', redisUrl })
    } catch (err) {
      app.log.warn({ err }, 'Redis session memory init failed, using in-memory fallback')
    }
  }

  app.post<{ Body: ChatBody }>('/api/chat', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['query', 'sessionId'],
        properties: {
          query: { type: 'string', minLength: 1 },
          sessionId: { type: 'string', minLength: 1 },
          model: {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['anthropic', 'openai', 'deepseek', 'ollama', 'groq', 'mistral', 'lmstudio'] },
              defaultModel: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { sub: userId, tenantId, role } = request.user
    // Validate tenantId is a UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      return reply.code(400).send({ error: 'Invalid tenantId' })
    }
    const { query, sessionId, model: modelOverride } = request.body

    // Resolve provider config — try DB first, fallback to env
    const providerConfig = modelOverride
      ? resolveProviderConfig(modelOverride)
      : (await providerConfigForTenant(tenantId, prisma)) ?? resolveProviderConfig()
    if (!providerConfig) {
      return reply.code(503).send({ error: 'No LLM provider configured — configure in Settings > AI Provider in the web UI' })
    }

    // Load connectors + tenant in parallel — both are best-effort
    const [connectorsResult, tenantResult] = await Promise.allSettled([
      withTenant(prisma, tenantId, (tx) =>
        tx.connector.findMany({ where: { tenant_id: tenantId } }),
      ),
      withTenant(prisma, tenantId, (tx) =>
        tx.tenant.findUnique({ where: { id: isValidUUID(tenantId) ? tenantId : '' } }),
      ),
    ])

    if (connectorsResult.status === 'rejected')
      request.log.error({ err: connectorsResult.reason }, 'failed to load connectors — proceeding with empty tool set')
    if (tenantResult.status === 'rejected')
      request.log.error({ err: tenantResult.reason }, 'failed to load tenant')
    const dbConnectors = connectorsResult.status === 'fulfilled' ? connectorsResult.value : []
    const dbTenant = tenantResult.status === 'fulfilled' ? tenantResult.value : null

    // Build perimeter from connector config
    const connectorScopes: ConnectorScope[] = dbConnectors.map((c) => {
      const raw = c.capability_manifest as {
        capabilities?: { read?: string[]; write?: string[] }
      }
      return {
        connectorId: c.id,
        read: raw.capabilities?.read ?? ['*'],
        write: c.mode === 'write' || c.mode === 'read_write' ? (raw.capabilities?.write ?? ['*']) : [],
      }
    })

    const userPerimeter: UserPerimeter = {
      userId: UserId(userId),
      connectors: connectorScopes,
    }

    const manifests: ConnectorManifest[] = dbConnectors.map((c) => {
      const raw = c.capability_manifest as {
        capabilities?: { read?: string[]; write?: string[] }
      }
      return {
        connectorId: c.id,
        mode: (c.mode === 'read_write' ? 'read-write' : c.mode) as 'read' | 'write' | 'read-write',
        capabilities: {
          read: raw.capabilities?.read ?? ['*'],
          write: raw.capabilities?.write ?? [],
        },
      }
    })

    const perimeter = AgentPerimeter.resolveCapabilities(userPerimeter, manifests)

    // Initialize session identity for all memory implementations
    try {
      await sessionMemory.initSession?.({
        sessionId: SessionId(sessionId),
        userId: UserId(userId),
        tenantId: TenantId(tenantId),
        effectiveRole: (role as AgentRole) ?? 'dev',
      })
    } catch (err) {
      request.log.warn({ err, sessionId }, 'initSession failed — session identity may be incomplete')
    }

    const sessionCtx: SessionContext = {
      sessionId: SessionId(sessionId),
      userId: UserId(userId),
      tenantId: TenantId(tenantId),
      effectiveRole: (role as AgentRole) ?? 'dev',
      turns: [],
    }

    const provider = ProviderFactory.create(providerConfig)
    const auditSink = new PostgresAuditSink(prisma, (err) => {
      request.log.error({ err }, 'audit write failed')
    })
    const sessionUsed = getSessionUsed(sessionId)
    const budget = buildTokenBudget(dbTenant?.token_budget_monthly, sessionUsed)

    const knowledgeGraph: IKnowledgeGraph = new StructuralGraph(
      (sql: string, params?: unknown[]) =>
        withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))),
    )
    const connectorTools = await getToolsForTenant(prisma, tenantId)
    const registrationTools = makeRegistrationTools(tenantId, (role as AgentRole) ?? 'dev')
    const allTools = [...connectorTools, ...registrationTools]

    // L2 gate — write actions require user approval (V1 trust principle)
    const gateSink = redisUrl ? new RedisGateSink(redisUrl) : undefined
    if (!gateSink) {
      request.log.error('REDIS_URL not set — gate approval bypassed (V1 trust violation)')
    }

    const orchestrator = createOrchestrator({
      model: provider,
      tools: allTools,
      perimeter,
      auditSink,
      sessionMemory,
      knowledgeGraph,
      budget,
      gateSink,
    })

    // SSE response setup
    const stream = new Readable({ read() {} })
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')
    reply.header('X-Accel-Buffering', 'no')

    // Create abort controller for client disconnect
    const abortController = new AbortController()
    request.raw.on('close', () => abortController.abort())

    // Agent loop runs in background; aborted on client disconnect
    void (async () => {
      let totalTokens = 0
      try {
        for await (const event of runSession(orchestrator, query, sessionCtx, abortController.signal)) {
          if (event.type === 'done') {
            totalTokens = event.inputTokens + event.outputTokens
            await auditSink.append({
              id: crypto.randomUUID(),
              tenantId: TenantId(tenantId),
              userId: UserId(userId),
              sessionId: SessionId(sessionId),
              eventType: 'session_end',
              payload: {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                totalTokens,
              },
              createdAt: new Date(),
            })
          }
          stream.push(`data: ${JSON.stringify(event)}\n\n`)
        }
        stream.push('data: [DONE]\n\n')
      } catch (err) {
        request.log.error({ err, sessionId }, 'chat session error')
        const errPayload = {
          type: 'error',
          code: 'UPSTREAM_ERROR',
          message: err instanceof Error ? err.message : 'internal error',
        }
        stream.push(`data: ${JSON.stringify(errPayload)}\n\n`)
      } finally {
        if (totalTokens > 0) recordSessionUsed(sessionId, totalTokens)
        stream.push(null)
      }
    })()

    return reply.send(stream)
  })
}

import { isValidUUID } from '../utils/validators.js'
