import { describe, it, expect, vi } from 'vitest'
import { RedisSessionMemory } from './redis-session.js'
import { SessionId, UserId, TenantId, AgentRole } from '@anway/types'
import type { SessionMeta, ConversationTurn } from '../interfaces/memory.js'
import type { IModelProvider, ChatResponse, InferenceOptions, ToolCall, ToolDefinition } from '../interfaces/provider.js'
import type { Message } from '@anway/types'

// ---------------------------------------------------------------------------
// Redis mock
// ---------------------------------------------------------------------------

function makeMockRedis() {
  const store = new Map<string, string>()
  const lists = new Map<string, string[]>()
  const ttls = new Map<string, number>()

  return {
    store,
    lists,
    ttls,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _ex: string, ttl: number) => {
      store.set(key, value)
      ttls.set(key, ttl)
      return 'OK'
    }),
    expire: vi.fn(async (key: string, ttl: number) => {
      ttls.set(key, ttl)
      return 1
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const k of keys) {
        store.delete(k)
        lists.delete(k)
      }
      return keys.length
    }),
    rpush: vi.fn(async (key: string, value: string) => {
      const existing = lists.get(key) ?? []
      lists.set(key, [...existing, value])
      return (lists.get(key) ?? []).length
    }),
    llen: vi.fn(async (key: string) => {
      return (lists.get(key) ?? []).length
    }),
    lrange: vi.fn(async (key: string, _start: number, _end: number) => {
      return lists.get(key) ?? []
    }),
  }
}

// ---------------------------------------------------------------------------
// IModelProvider mock for summarise
// ---------------------------------------------------------------------------

class MockSummariseProvider implements IModelProvider {
  readonly modelId = 'mock-model'
  readonly cheapModelId = 'mock-model-cheap'
  readonly lastPrompt: string[] = []

  async chat(messages: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): Promise<ChatResponse> {
    const content = messages[messages.length - 1]?.content ?? ''
    this.lastPrompt.push(typeof content === 'string' ? content : JSON.stringify(content))
    return {
      content: 'MOCK SUMMARY',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    }
  }

  async *stream(_messages: Message[], _tools: ToolDefinition[], _opts: InferenceOptions) {
    yield { type: 'done' as const, inputTokens: 0, outputTokens: 0 }
  }

  formatToolResult(_toolCallId: string, result: unknown): Message {
    return { role: 'user', content: JSON.stringify(result) }
  }

  formatToolCall(_toolCalls: ToolCall[]): Message {
    return { role: 'assistant', content: '' }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_TTL = 86400

function makeMeta(): SessionMeta {
  return {
    sessionId: SessionId('sess-001'),
    userId: UserId('user-001'),
    tenantId: TenantId('tenant-001'),
    effectiveRole: AgentRole.sre,
  }
}

function makeTurn(i: number): ConversationTurn {
  return {
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i}`,
    timestamp: 1000 + i,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RedisSessionMemory.get', () => {
  it('returns null when session does not exist', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const result = await mem.get(SessionId('missing'))
    expect(result).toBeNull()
  })

  it('returns SessionContext with turns after init + append', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()

    await mem.initSession(meta)
    await mem.append(meta.sessionId, makeTurn(0))

    const ctx = await mem.get(meta.sessionId)
    expect(ctx).not.toBeNull()
    expect(ctx!.sessionId).toBe(meta.sessionId)
    expect(ctx!.userId).toBe(meta.userId)
    expect(ctx!.tenantId).toBe(meta.tenantId)
    expect(ctx!.effectiveRole).toBe(meta.effectiveRole)
    expect(ctx!.turns).toHaveLength(1)
    expect(ctx!.turns[0]!.content).toBe('turn 0')
  })

  it('returns empty turns array when meta exists but no turns appended', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)

    await mem.initSession(makeMeta())
    const ctx = await mem.get(SessionId('sess-001'))
    expect(ctx!.turns).toHaveLength(0)
  })
})

describe('RedisSessionMemory.append', () => {
  it('accumulates multiple turns in order', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()

    await mem.initSession(meta)
    await mem.append(meta.sessionId, makeTurn(0))
    await mem.append(meta.sessionId, makeTurn(1))
    await mem.append(meta.sessionId, makeTurn(2))

    const ctx = await mem.get(meta.sessionId)
    expect(ctx!.turns).toHaveLength(3)
    expect(ctx!.turns[0]!.content).toBe('turn 0')
    expect(ctx!.turns[2]!.content).toBe('turn 2')
  })

  it('resets TTL to 24h on every append', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()

    await mem.initSession(meta)
    await mem.append(meta.sessionId, makeTurn(0))

    // expire() called for turns key with SESSION_TTL
    const turnsExpireCalls = (redis.expire.mock.calls as Array<[string, number]>).filter(
      ([k]) => k.includes(':turns'),
    )
    expect(turnsExpireCalls.at(-1)).toEqual([`session:${meta.sessionId}:turns`, SESSION_TTL])

    // expire() called for meta key
    expect(redis.expire).toHaveBeenCalledWith(
      `session:${meta.sessionId}:meta`,
      SESSION_TTL,
    )
  })
})

describe('RedisSessionMemory.summarise', () => {
  it('compresses turns older than last 10 into summary turn', async () => {
    const redis = makeMockRedis()
    const provider = new MockSummariseProvider()
    const mem = new RedisSessionMemory(redis as never, provider)
    const meta = makeMeta()

    await mem.initSession(meta)

    // Add 15 turns without triggering auto-summarise (limit is 50)
    // We call summarise() directly after manually loading 15 turns
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i))
    // Bypass append (would auto-trigger only at >50) — set directly
    redis.lists.set(`session:${meta.sessionId}:turns`, turns.map(t => JSON.stringify(t)))
    redis.store.set(`session:${meta.sessionId}:meta`, JSON.stringify(meta))

    await mem.summarise(meta.sessionId)

    const ctx = await mem.get(meta.sessionId)
    // 1 summary turn + 10 kept turns = 11
    expect(ctx!.turns).toHaveLength(11)
    expect(ctx!.turns[0]!.content).toContain('[SUMMARY]')
    expect(ctx!.turns[0]!.content).toContain('MOCK SUMMARY')
    // last 10 original turns preserved in order
    expect(ctx!.turns[1]!.content).toBe('turn 5')
    expect(ctx!.turns[10]!.content).toBe('turn 14')
  })

  it('does nothing when turns count <= 10', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()

    await mem.initSession(meta)
    const turns = Array.from({ length: 5 }, (_, i) => makeTurn(i))
    redis.lists.set(`session:${meta.sessionId}:turns`, turns.map(t => JSON.stringify(t)))

    await mem.summarise(meta.sessionId)

    const ctx = await mem.get(meta.sessionId)
    expect(ctx!.turns).toHaveLength(5)
  })

  it('uses fallback summary text when no provider injected', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never) // no provider
    const meta = makeMeta()

    await mem.initSession(meta)
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i))
    redis.lists.set(`session:${meta.sessionId}:turns`, turns.map(t => JSON.stringify(t)))

    await mem.summarise(meta.sessionId)

    const ctx = await mem.get(meta.sessionId)
    expect(ctx!.turns[0]!.content).toContain('[SUMMARY]')
    expect(ctx!.turns[0]!.content).toContain('5 earlier turns')
  })

  it('auto-summarises when append causes turn count to exceed 50', async () => {
    const redis = makeMockRedis()
    const provider = new MockSummariseProvider()
    const mem = new RedisSessionMemory(redis as never, provider)
    const meta = makeMeta()

    await mem.initSession(meta)

    // Pre-load 50 turns directly
    const turns = Array.from({ length: 50 }, (_, i) => makeTurn(i))
    redis.lists.set(`session:${meta.sessionId}:turns`, turns.map(t => JSON.stringify(t)))

    // This append pushes count to 51 → auto-summarise fires
    await mem.append(meta.sessionId, makeTurn(50))

    const ctx = await mem.get(meta.sessionId)
    // 1 summary + 10 kept = 11
    expect(ctx!.turns).toHaveLength(11)
    expect(ctx!.turns[0]!.content).toContain('[SUMMARY]')
  })
})

describe('RedisSessionMemory.clear', () => {
  it('deletes both meta and turns keys', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()

    await mem.initSession(meta)
    await mem.append(meta.sessionId, makeTurn(0))

    await mem.clear(meta.sessionId)

    expect(redis.del).toHaveBeenCalledWith(
      `session:${meta.sessionId}:turns`,
      `session:${meta.sessionId}:meta`,
    )
    const ctx = await mem.get(meta.sessionId)
    expect(ctx).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ISessionMemory contract via RedisSessionMemory
// ---------------------------------------------------------------------------

describe('ISessionMemory contract', () => {
  it('get() → append() → get() round-trip preserves all turn fields', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()

    await mem.initSession(meta)

    const turn: ConversationTurn = {
      role: 'user',
      content: 'hello world',
      toolCalls: [{ id: 'tc-1', name: 'search', args: { q: 'test' } }],
      timestamp: 999,
    }

    await mem.append(meta.sessionId, turn)
    const ctx = await mem.get(meta.sessionId)

    expect(ctx!.turns[0]).toEqual(turn)
  })
})

// ---------------------------------------------------------------------------
// Multi-repo session entity carryover (CLAUDE.md capability #8)
// ---------------------------------------------------------------------------

describe('RedisSessionMemory.updateContextEntities', () => {
  it('persists the entity set into session meta and get() returns it', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()
    await mem.initSession(meta)

    const entities = [
      { id: 'e-checkout', name: 'checkout-api' },
      { id: 'e-payments', name: 'payments-api' },
    ]
    await mem.updateContextEntities(meta.sessionId, entities)

    const ctx = await mem.get(meta.sessionId)
    expect(ctx!.contextEntities).toEqual(entities)
    expect(ctx!.contextEntityId).toBe('e-checkout')
  })

  it('is a no-op when session meta does not exist yet', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    await mem.updateContextEntities(SessionId('missing'), [{ id: 'e1', name: 'svc' }])
    expect(redis.store.size).toBe(0)
  })
})

describe('RedisSessionMemory.initSession meta preservation', () => {
  it('re-init on a later turn preserves contextEntities and summary written mid-session', async () => {
    // Regression: the gateway calls initSession on EVERY request of a
    // session — a plain overwrite wiped the pinned multi-repo entity set
    // (and the rolling summary) each new turn.
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()
    await mem.initSession(meta)

    const entities = [{ id: 'e-checkout', name: 'checkout-api' }]
    await mem.updateContextEntities(meta.sessionId, entities)
    redis.store.set(`session:${meta.sessionId}:meta`, JSON.stringify({
      ...JSON.parse(redis.store.get(`session:${meta.sessionId}:meta`)!),
      summary: 'earlier turns summary',
    }))

    // next turn: gateway re-inits with the same identity fields only
    await mem.initSession(meta)

    const ctx = await mem.get(meta.sessionId)
    expect(ctx!.contextEntities).toEqual(entities)
    expect(ctx!.contextEntityId).toBe('e-checkout')
    expect(ctx!.summary).toBe('earlier turns summary')
  })

  it('re-init with explicit fields still overrides preserved ones', async () => {
    const redis = makeMockRedis()
    const mem = new RedisSessionMemory(redis as never)
    const meta = makeMeta()
    await mem.initSession(meta)
    await mem.updateContextEntities(meta.sessionId, [{ id: 'e1', name: 'old-svc' }])

    await mem.initSession({ ...meta, contextEntities: [{ id: 'e2', name: 'new-svc' }] })

    const ctx = await mem.get(meta.sessionId)
    expect(ctx!.contextEntities).toEqual([{ id: 'e2', name: 'new-svc' }])
  })
})
