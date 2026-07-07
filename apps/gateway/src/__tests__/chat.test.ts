import { afterEach, describe, it, expect } from 'vitest'
import {
  createOrchestrator,
  runSession,
  AgentPerimeter,
} from '@anway/agent'
import type {
  IModelProvider,
  IAuditSink,
  AuditEvent,
  ISessionMemory,
  ConversationTurn,
  SessionContext,
  ToolDefinition,
  InferenceOptions,
  ChatResponse,
  ToolCall,
} from '@anway/agent'
import type { StreamChunk } from '@anway/agent'
import { TenantId, UserId, SessionId } from '@anway/types'
import type { Message } from '@anway/types'
import { resolveProviderConfig } from '../routes/chat.js'

const providerEnvKeys = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OLLAMA_ENDPOINT',
  'LMSTUDIO_ENDPOINT',
] as const

afterEach(() => {
  for (const key of providerEnvKeys) {
    delete process.env[key]
  }
})

// ---- Test doubles ----

class InMemoryAuditSink implements IAuditSink {
  readonly events: AuditEvent[] = []
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event)
  }
}

class InMemoryTestMemory implements ISessionMemory {
  private readonly turns = new Map<string, ConversationTurn[]>()

  async get(sessionId: SessionId): Promise<SessionContext | null> {
    const stored = this.turns.get(sessionId)
    if (!stored) return null
    return {
      sessionId,
      userId: UserId('test-user'),
      tenantId: TenantId('test-tenant'),
      effectiveRole: 'dev',
      turns: stored,
    }
  }

  async append(sessionId: SessionId, turn: ConversationTurn): Promise<void> {
    const existing = this.turns.get(sessionId) ?? []
    this.turns.set(sessionId, [...existing, turn])
  }

  async summarise(_sessionId: SessionId): Promise<void> {}

  async clear(sessionId: SessionId): Promise<void> {
    this.turns.delete(sessionId)
  }
}

function makeMockProvider(chunks: StreamChunk[]): IModelProvider {
  return {
    modelId: 'mock-model',
    cheapModelId: 'mock-model-cheap',
    async chat(_msgs: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): Promise<ChatResponse> {
      return { content: '{}', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }
    },
    async *stream(_msgs: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) {
        yield chunk
      }
    },
    formatToolResult(_toolCallId: string, result: unknown): Message {
      return { role: 'user', content: JSON.stringify(result) }
    },
    formatToolCall(_toolCalls: ToolCall[]): Message {
      return { role: 'assistant', content: '' }
    },
  }
}

function makeMockKG() {
  return {
    addEpisode: async () => {},
    getFacts: async () => [],
    getEntity: async () => null,
    getRelationships: async () => [],
    search: async () => [],
    resolveContext: async () => ({ primaryEntity: { id: 'e1', tenantId: 't1', type: 'Service', name: 'test', metadata: {} }, relatedEntities: [], relationships: [], recentEpisodes: [], connectorCoordinates: {}, groundingSources: [], freshness: 1.0 }),
    resolveContextByName: async () => null,
    getEntityByExternalRef: async () => null,
    upsertEntity: async () => 'e1',
    upsertRelationship: async () => 'r1',
    markConnectorEntitiesStale: async () => 0,
    deleteEntitiesByOrgPrefix: async () => 0,
  }
}

// ---- Tests ----

describe('runSession — streaming and audit', () => {
  it('yields text_delta and done events from provider', async () => {
    const auditSink = new InMemoryAuditSink()
    const provider = makeMockProvider([
      { type: 'text_delta', content: 'hello' },
      { type: 'done', inputTokens: 5, outputTokens: 3 },
    ])

    const perimeter = AgentPerimeter.resolveCapabilities(
      { userId: UserId('u1'), connectors: [] },
      [],
    )

    const orchestrator = createOrchestrator({
      model: provider,
      tools: [],
      perimeter,
      auditSink,
      sessionMemory: new InMemoryTestMemory(),
      knowledgeGraph: makeMockKG(),
    })

    const ctx: SessionContext = {
      sessionId: SessionId('sess-1'),
      userId: UserId('u1'),
      tenantId: TenantId('t1'),
      effectiveRole: 'dev',
      turns: [],
    }

    const events: StreamChunk[] = []
    for await (const event of runSession(orchestrator, 'hello', ctx)) {
      events.push(event)
    }

    const textEvents = events.filter((e) => e.type === 'text_delta')
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0]).toMatchObject({ type: 'text_delta', content: 'hello' })
    expect(doneEvents).toHaveLength(1)
  })

  it('emits query_received and agent_spawned audit events', async () => {
    const auditSink = new InMemoryAuditSink()
    const provider = makeMockProvider([
      { type: 'done', inputTokens: 2, outputTokens: 1 },
    ])

    const perimeter = AgentPerimeter.resolveCapabilities(
      { userId: UserId('u2'), connectors: [] },
      [],
    )

    const orchestrator = createOrchestrator({
      model: provider,
      tools: [],
      perimeter,
      auditSink,
      sessionMemory: new InMemoryTestMemory(),
      knowledgeGraph: makeMockKG(),
    })

    const ctx: SessionContext = {
      sessionId: SessionId('sess-2'),
      userId: UserId('u2'),
      tenantId: TenantId('t2'),
      effectiveRole: 'sre',
      turns: [],
    }

    const iter = runSession(orchestrator, 'check alerts', ctx)
    for await (const _event of iter) {
      void _event
    }

    const eventTypes = auditSink.events.map((e) => e.eventType)
    expect(eventTypes).toContain('query_received')
    expect(eventTypes).toContain('agent_spawned')
  })

  it('includes token usage in done event', async () => {
    const auditSink = new InMemoryAuditSink()
    const provider = makeMockProvider([
      { type: 'text_delta', content: 'response' },
      { type: 'done', inputTokens: 42, outputTokens: 17 },
    ])

    const perimeter = AgentPerimeter.resolveCapabilities(
      { userId: UserId('u3'), connectors: [] },
      [],
    )

    const orchestrator = createOrchestrator({
      model: provider,
      tools: [],
      perimeter,
      auditSink,
      sessionMemory: new InMemoryTestMemory(),
      knowledgeGraph: makeMockKG(),
    })

    const ctx: SessionContext = {
      sessionId: SessionId('sess-3'),
      userId: UserId('u3'),
      tenantId: TenantId('t3'),
      effectiveRole: 'pm',
      turns: [],
    }

    const events: StreamChunk[] = []
    for await (const event of runSession(orchestrator, 'query', ctx)) {
      events.push(event)
    }

    const doneEvent = events.find((e) => e.type === 'done')
    expect(doneEvent).toBeDefined()
    // 42/17 is the synthesis stream call's own usage — the `done` event now
    // reports a real cumulative total across the whole session (intent
    // classification + entity extraction + every ConnectorAgent + synthesis),
    // not just the final call's tokens (see orchestrator.ts's totalInputTokens/
    // totalOutputTokens comment — this session's fix for a real gateway
    // undercount of token_usage_daily/monthly-budget enforcement). This mock
    // provider's chat() (used for both intent classification and entity
    // extraction) returns usage: {inputTokens:1, outputTokens:1} each call,
    // so the real total is 42+1+1=44 / 17+1+1=19.
    expect(doneEvent).toMatchObject({ type: 'done', inputTokens: 44, outputTokens: 19 })
  })

  it('perimeter-blocked tool calls are audited as tool_call_blocked in ConnectorAgent', async () => {
    const auditSink = new InMemoryAuditSink()
    const toolName = 'github__list_prs'

    // Provider whose chat() returns a tool call for ConnectorAgent
    let chatCalls = 0
    const provider: IModelProvider = {
      modelId: 'mock-model',
      cheapModelId: 'mock-model-cheap',
      async chat(msgs: Message[], tools: ToolDefinition[], _opts: InferenceOptions): Promise<ChatResponse> {
        // Intent classification (no tools in args)
        if (tools.length === 0) {
          return { content: '{"intent":"general"}', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }
        }
        chatCalls++
        if (chatCalls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'call-1', name: toolName, args: { resource: 'org/repo' } }],
            usage: { inputTokens: 20, outputTokens: 5 },
          }
        }
        return { content: 'Summary.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }
      },
      async *stream(_msgs: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): AsyncGenerator<StreamChunk> {
        yield { type: 'text_delta' as const, content: 'Synthesis.' }
        yield { type: 'done' as const, inputTokens: 30, outputTokens: 15 }
      },
      formatToolResult(_toolCallId: string, result: unknown): Message {
        return { role: 'user', content: JSON.stringify(result) }
      },
      formatToolCall(_toolCalls: ToolCall[]): Message {
        return { role: 'assistant', content: '' }
      },
    }

    // Empty perimeter — no connectors allowed
    const perimeter = AgentPerimeter.resolveCapabilities(
      { userId: UserId('u4'), connectors: [] },
      [],
    )

    const execTool = {
      name: toolName,
      description: 'List PRs',
      parameters: {},
      async run() { return 'should not execute' },
    }

    const orchestrator = createOrchestrator({
      model: provider,
      tools: [execTool],
      perimeter,
      auditSink,
      sessionMemory: new InMemoryTestMemory(),
      knowledgeGraph: makeMockKG(),
    })

    const ctx: SessionContext = {
      sessionId: SessionId('sess-4'),
      userId: UserId('u4'),
      tenantId: TenantId('t4'),
      effectiveRole: 'dev',
      turns: [],
    }

    const events: StreamChunk[] = []
    for await (const event of runSession(orchestrator, 'list PRs', ctx)) {
      events.push(event)
    }

    // Perimeter blocks happen inside ConnectorAgent and are audit-logged
    const blocked = auditSink.events.filter((e) => e.eventType === 'tool_call_blocked')
    expect(blocked.length).toBeGreaterThan(0)
  })
})

describe('chat provider config resolution', () => {
  it('uses server-side API keys and ignores client-supplied secrets', () => {
    process.env['ANTHROPIC_API_KEY'] = 'server-key'

    const config = resolveProviderConfig({
      type: 'anthropic',
      defaultModel: 'claude-test',
      apiKey: 'client-key',
    } as never)

    expect(config).toMatchObject({
      type: 'anthropic',
      apiKey: 'server-key',
      defaultModel: 'claude-test',
    })
  })

  it('returns null when the requested provider is not configured server-side', () => {
    process.env['ANTHROPIC_API_KEY'] = 'server-key'

    const config = resolveProviderConfig({ type: 'openai' })

    expect(config).toBeNull()
  })
})
