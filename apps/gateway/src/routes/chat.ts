import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
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
import { makeDeployTools } from '../tools/deploy-tools.js'
import { RedisGateSink } from '../gate/redis-gate-sink.js'
import { getMemoryGateSink } from '../gate/memory-gate-fallback.js'
import { isValidUUID } from '../utils/validators.js'
import { decryptJson } from '../utils/crypto.js'

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

  async summarise(sessionId: SessionId): Promise<void> {
    const ctx = await this.get(sessionId)
    if (!ctx || ctx.turns.length <= 10) return
    const toSummarise = ctx.turns.slice(0, ctx.turns.length - 10)
    const summaryLines = toSummarise
      .filter(t => t.role === 'user' || t.role === 'assistant')
      .slice(-20)
      .map(t => `${t.role}: ${typeof t.content === 'string' ? t.content.slice(0, 200) : JSON.stringify(t.content).slice(0, 200)}`)
    const summary = summaryLines.length > 0
      ? `Earlier conversation summary (${summaryLines.length} turns): ${summaryLines.join(' | ')}`
      : 'No prior conversation to summarize.'
    const summaryTurn: ConversationTurn = { role: 'system' as const, content: `[Summary of earlier conversation]: ${summary}`, timestamp: Date.now() }
    const kept = [summaryTurn, ...ctx.turns.slice(ctx.turns.length - 10)]
    this.turns.set(sessionId, kept)
  }

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
    return { type: 'ollama', baseURL: process.env['OLLAMA_ENDPOINT'], defaultModel: process.env['OLLAMA_DEFAULT_MODEL'] }
  }
  if (type === 'lmstudio' && process.env['LMSTUDIO_ENDPOINT']) {
    return { type: 'lmstudio', baseURL: process.env['LMSTUDIO_ENDPOINT'], defaultModel: process.env['LMSTUDIO_DEFAULT_MODEL'] }
  }
  if (type === 'deepseek' && process.env['DEEPSEEK_API_KEY']) {
    return { type: 'deepseek', apiKey: process.env['DEEPSEEK_API_KEY'], baseURL: 'https://api.deepseek.com' }
  }
  return null
}

// Providers that run without an API key (local endpoints)
const KEYLESS_PROVIDERS = new Set(['ollama', 'lmstudio'])

async function providerConfigForTenant(
  tenantId: string,
  client: PrismaClient,
): Promise<ProviderConfig | null> {
  const row = await withTenant(client, tenantId, (tx) =>
    tx.$queryRaw<{ provider: string; api_key_enc: string | null; base_url: string | null; default_model: string | null; cheap_model: string | null }[]>`
      SELECT provider, api_key_enc, base_url, default_model, cheap_model FROM provider_config WHERE tenant_id = ${tenantId}::uuid
    `
  ).catch(() => [])
  if (row.length > 0 && (row[0]!.api_key_enc || KEYLESS_PROVIDERS.has(row[0]!.provider))) {
    const r = row[0]!
    return {
      type: r.provider as ProviderConfig['type'],
      apiKey: r.api_key_enc ? decryptJson<string>(r.api_key_enc) : undefined,
      ...(r.base_url ? { baseURL: r.base_url } : {}),
      ...(r.default_model ? { defaultModel: r.default_model } : {}),
      ...(r.cheap_model ? { cheapModel: r.cheap_model } : {}),
    }
  }
  return null  // fallback to env-based config
}

function withDefaultModel(config: ProviderConfig, defaultModel?: string): ProviderConfig {
  return defaultModel ? { ...config, defaultModel } : config
}

function withCheapModel(config: ProviderConfig, cheapModel?: string): ProviderConfig {
  return cheapModel ? { ...config, cheapModel } : config
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

async function loadTokenUsage(tenantId: string): Promise<{ daily: number; monthly: number; }> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const monthStart = new Date()
    monthStart.setDate(1)
    const monthStartStr = monthStart.toISOString().slice(0, 10)
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ daily: bigint; monthly: bigint }>>`
        SELECT
          COALESCE(SUM(CASE WHEN date = ${today}::date THEN tokens_used ELSE 0 END), 0) AS daily,
          COALESCE(SUM(CASE WHEN date >= ${monthStartStr}::date THEN tokens_used ELSE 0 END), 0) AS monthly
        FROM token_usage_daily WHERE tenant_id = ${tenantId}::uuid
      `
    ).catch(() => [])
    if (rows.length > 0) {
      return { daily: Number(rows[0]!.daily), monthly: Number(rows[0]!.monthly) }
    }
  } catch { /* table may not exist — return zeros */ }
  return { daily: 0, monthly: 0 }
}

function buildTokenBudget(monthlyLimit = 1_000_000, sessionUsed = 0, dailyUsed = 0, monthlyUsed = 0): TokenBudget {
  return {
    perQueryHardLimit: 100_000,
    perSessionLimit: 500_000,
    perTenantDailyLimit: Math.ceil(monthlyLimit / 30),
    perTenantMonthlyLimit: monthlyLimit,
    sessionUsed,
    tenantDailyUsed: dailyUsed,
    tenantMonthlyUsed: monthlyUsed,
  }
}

// Module-level caches — bounded to prevent memory leak
const MAX_CACHE_ENTRIES = 200
function cacheSet<K, V>(map: Map<K, V>, key: K, val: V): void {
  if (map.size >= MAX_CACHE_ENTRIES) { const k = map.keys().next().value; if (k !== undefined) map.delete(k) }
  map.set(key, val)
}

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
  cacheSet(sessionTokenUsage, sessionId, { used: prev + tokens, lastSeen: Date.now() })
}

// Redis budget client — singleton to avoid O(requests) connections per handler invocation
let _redisBudget: RedisClientType | null = null
let _redisBudgetConnecting: Promise<RedisClientType | null> | null = null
function getRedisBudget(): RedisClientType | null {
  if (!process.env['REDIS_URL']) return null
  if (_redisBudget) return _redisBudget
  if (_redisBudgetConnecting) return null  // connecting — caller handles null
  _redisBudgetConnecting = (async () => {
    const client = createClient({
      url: process.env['REDIS_URL'],
      socket: { reconnectStrategy: (r) => Math.min(r * 100, 3000) },
    }) as RedisClientType
    client.on('error', () => {})
    await client.connect()
    _redisBudget = client
    return client
  })().catch(() => { _redisBudgetConnecting = null; return null })
  return null  // connecting — caller retries next time
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
          query: { type: 'string', minLength: 1, maxLength: 32768 },
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

    // Resolve provider config — DB (tenant-selected) first, env fallback.
    // A model override only changes the model; it must not discard the
    // tenant's stored credentials for that provider.
    const dbConfig = await providerConfigForTenant(tenantId, prisma)
    const providerConfig = modelOverride
      ? (dbConfig && dbConfig.type === modelOverride.type
          ? withDefaultModel(dbConfig, modelOverride.defaultModel)
          : resolveProviderConfig(modelOverride))
      : dbConfig ?? resolveProviderConfig()
    if (!providerConfig) {
      return reply.code(503).send({ error: 'No LLM provider configured', code: 'NO_PROVIDER' })
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

    // Token budget enforcement — Postgres authoritative check (not Redis-only)
    const usage = await loadTokenUsage(tenantId)
    const monthly = usage.monthly ?? 0
    const monthlyBudget = dbTenant?.token_budget_monthly
    if (monthlyBudget != null && monthly >= Number(monthlyBudget)) {
      return reply.code(429).send({ error: 'monthly token budget exceeded', code: 'BUDGET_EXCEEDED' })
    }

    // Build perimeter from connector config.
    // Scopes are keyed by the TOOL PREFIX — adapters name tools
    // `<connector-name>.<action>` (row.name || row.type), so the perimeter
    // must use the same key. Keying by DB UUID makes allows() miss every
    // lookup and hard-block all connector tools.
    const toolPrefix = (c: { name: string | null; type: string }) => c.name || c.type
    const connectorScopes: ConnectorScope[] = dbConnectors.map((c) => {
      const raw = c.capability_manifest as {
        capabilities?: { read?: string[]; write?: string[] }
      }
      return {
        connectorId: toolPrefix(c),
        read: raw.capabilities?.read ?? ['*'],
        // Absent write manifest → deny (not ['*']); explicit list → use it
        write: c.mode === 'write' || c.mode === 'read_write' ? (raw.capabilities?.write ?? []) : [],
      }
    })

    // Load user-specific perimeter overrides from DB
    const userPerimeterRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_name: string; read_scopes: string[]; write_scopes: string[] }[]>`
        SELECT connector_name, read_scopes, write_scopes FROM user_perimeters
        WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid
      `
    ).catch(() => [])
    for (let i = 0; i < connectorScopes.length; i++) {
      const scope = connectorScopes[i]!
      const row = userPerimeterRows.find(r => r.connector_name === scope.connectorId)
      if (!row) continue
      // Intersect user perimeter with connector manifest defaults.
      // A user cannot exceed what the connector manifest declares — prevents a rogue
      // admin granting write:['*'] on a read-only connector via user_perimeters.
      connectorScopes[i] = {
        connectorId: scope.connectorId,
        read: row.read_scopes,
        // Deny write if the manifest-derived default is empty (read-only connector)
        write: scope.write.length === 0 ? [] : row.write_scopes,
      }
    }

    const userPerimeter: UserPerimeter = {
      userId: UserId(userId),
      connectors: connectorScopes,
    }

    const manifests: ConnectorManifest[] = dbConnectors.map((c) => {
      const raw = c.capability_manifest as {
        capabilities?: { read?: string[]; write?: string[] }
      }
      return {
        connectorId: toolPrefix(c),
        mode: (c.mode === 'read_write' ? 'read-write' : c.mode) as 'read' | 'write' | 'read-write',
        capabilities: {
          read: raw.capabilities?.read ?? ['*'],
          write: raw.capabilities?.write ?? [],
        },
      }
    })

    // Harness built-in tools (bare names, no connector prefix) — explicit
    // allowlist in the perimeter. register_connector is a write action and
    // still goes through the L2 gate; its admin-role check lives in the tool.
    const registrationTools = makeRegistrationTools(tenantId, (role as AgentRole) ?? 'dev')
    const perimeter = AgentPerimeter.resolveCapabilities(
      userPerimeter,
      manifests,
      registrationTools.map((t) => t.name),
    )

    // Ownership check: reject if sessionId is claimed by a different tenant OR user.
    // Fail closed on Redis error — client-supplied sessionId must not bypass ownership check.
    try {
      const existingSession = await sessionMemory.get(SessionId(sessionId))
      if (existingSession !== null &&
          (existingSession.tenantId !== tenantId || existingSession.userId !== userId)) {
        return reply.code(403).send({ error: 'session not found' })
      }
    } catch {
      return reply.code(503).send({ error: 'session store unavailable — retry' })
    }

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
    const budget = buildTokenBudget(dbTenant?.token_budget_monthly, sessionUsed, usage.daily, usage.monthly)

    const knowledgeGraph: IKnowledgeGraph = new StructuralGraph(
      (sql: string, params?: unknown[]) =>
        withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))),
    )
    const connectorTools = await getToolsForTenant(prisma, tenantId)
    const deployTools = makeDeployTools(tenantId, userId, provider, knowledgeGraph)
    const allTools = [...connectorTools, ...registrationTools, ...deployTools]

    // L2 gate — write actions require user approval (V1 trust principle)
    const gateSink = redisUrl ? new RedisGateSink(redisUrl, tenantId) : getMemoryGateSink()
    if (!redisUrl) {
      request.log.warn('REDIS_URL not set — using in-process gate sink (single-instance only)')
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
      connectors: dbConnectors.map((c) => ({
        name: c.name || c.type,
        type: c.type,
        mode: c.mode,
      })),
    })

    // SSE response setup — Redis fan-out for multi-pod, direct stream for single-pod
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')
    reply.header('X-Accel-Buffering', 'no')

    // Create abort controller for client disconnect or 120s LLM timeout
    const abortController = new AbortController()
    const llmTimeout = setTimeout(() => abortController.abort(), 120_000)
    request.raw.on('close', () => { clearTimeout(llmTimeout); abortController.abort() })

    // Redis SSE fan-out — enables multi-pod gateway deployments
    const chatRedisUrl = process.env['REDIS_URL']
    let chatPub: RedisClientType | null = null
    let chatSub: RedisClientType | null = null

    if (chatRedisUrl) {
      try {
        chatPub = createClient({ url: chatRedisUrl }) as RedisClientType
        chatSub = chatPub.duplicate()
        await chatPub.connect()
        await chatSub.connect()
        const channel = `sse:chat:${sessionId}`
        await chatSub.subscribe(channel, (message, _channel) => {
          reply.raw.write(`data: ${message}\n\n`)
        })
        request.raw.on('close', async () => {
          try { await chatSub!.unsubscribe(channel) } catch {}
          try { await chatSub!.quit() } catch {}
          try { await chatPub!.quit() } catch {}
        })
      } catch (err) {
        request.log.warn({ err }, 'chat Redis fan-out failed — falling back to direct stream')
        try { await chatSub?.quit() } catch {}
        try { await chatPub?.quit() } catch {}
        chatPub = null
        chatSub = null
      }
    }

    // Agent loop runs in background; aborted on client disconnect
    const stream = new Readable({ read() {} })
    void (async () => {
      let totalTokens = 0
      let accumulatedAssistantText = ''
      try {
        await auditSink.append({
          id: crypto.randomUUID(),
          tenantId: TenantId(tenantId),
          userId: UserId(userId),
          sessionId: SessionId(sessionId),
          eventType: 'query_started' as any,
          payload: {
            query,
            authRole: role,
            inferredRole: role,
          },
          createdAt: new Date(),
        }).catch(() => {})
        for await (const event of runSession(orchestrator, query, sessionCtx, abortController.signal)) {
          if (event.type === 'text_delta') {
            accumulatedAssistantText += event.content
          }
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
            // Persist conversation turns to DB for session restore
            if (accumulatedAssistantText) {
              void withTenant(prisma, tenantId, (tx) =>
                tx.$executeRaw`
                  INSERT INTO session_turns (tenant_id, session_id, role, content)
                  VALUES (${tenantId}::uuid, ${sessionId}, 'user', ${query}),
                         (${tenantId}::uuid, ${sessionId}, 'assistant', ${accumulatedAssistantText})
                  ON CONFLICT (tenant_id, session_id, role, content, created_at) DO NOTHING
                `
              ).catch(() => { /* best-effort */ })
            }
            // Persist token usage to DB
            if (totalTokens > 0) {
              // Redis token counter (real-time budget tracking)
              if (redisUrl) {
                try {
                  const redisBudget = getRedisBudget()
                  if (redisBudget) {
                    const monthKey = `tokens:${tenantId}:${new Date().toISOString().slice(0, 7)}`
                    await redisBudget.incrBy(monthKey, totalTokens)
                    const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
                    await redisBudget.expireAt(monthKey, Math.floor(nextMonth.getTime() / 1000))
                  }
                } catch { /* Redis may be unavailable */ }
              }
              try {
                const today = new Date().toISOString().slice(0, 10)
                await withTenant(prisma, tenantId, (tx) =>
                  tx.$executeRaw`
                    INSERT INTO token_usage_daily (tenant_id, date, tokens_used)
                    VALUES (${tenantId}::uuid, ${today}::date, ${totalTokens})
                    ON CONFLICT (tenant_id, date)
                    DO UPDATE SET tokens_used = token_usage_daily.tokens_used + ${totalTokens}, updated_at = NOW()
                  `
                )
              } catch (err) { request.log.error({ err }, 'token usage write failed — budget may be undercounted') }
            }
          }
          const msg = JSON.stringify(event)
          if (chatPub) {
            void chatPub.publish(`sse:chat:${sessionId}`, msg)
          } else {
            stream.push(`data: ${msg}\n\n`)
          }
        }
        const doneMsg = JSON.stringify('[DONE]')
        if (chatPub) {
          void chatPub.publish(`sse:chat:${sessionId}`, doneMsg)
        } else {
          stream.push('data: [DONE]\n\n')
        }
      } catch (err) {
        request.log.error({ err, sessionId }, 'chat session error')
        const errPayload = {
          type: 'error',
          code: 'UPSTREAM_ERROR',
          message: err instanceof Error ? err.message : 'internal error',
        }
        if (chatPub) {
          void chatPub.publish(`sse:chat:${sessionId}`, JSON.stringify(errPayload))
        } else {
          stream.push(`data: ${JSON.stringify(errPayload)}\n\n`)
        }
      } finally {
        clearTimeout(llmTimeout)
        if (totalTokens > 0) recordSessionUsed(sessionId, totalTokens)
        if (chatPub) {
          await new Promise(r => setTimeout(r, 150))
          reply.raw.end()
        } else {
          stream.push(null)
        }
        // Trigger session summarisation if turns exceed threshold
        void (async () => {
          try {
            const ctx = await sessionMemory.get(SessionId(sessionId))
            if (ctx && ctx.turns.length > 50) {
              await sessionMemory.summarise(SessionId(sessionId))
            }
          } catch { /* summarisation is best-effort */ }
        })()
      }
    })()

    return reply.send(stream)
  })
}

