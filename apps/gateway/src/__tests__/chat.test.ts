import { describe, it, expect } from 'vitest'
import {
  createOrchestrator,
  runSession,
  AgentPerimeter,
} from '@anvay/agent'
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
} from '@anvay/agent'
import type { StreamChunk } from '@anvay/agent'
import { TenantId, UserId, SessionId } from '@anvay/types'
import type { Message } from '@anvay/types'

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
    async chat(_msgs: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): Promise<ChatResponse> {
      return { content: '{}', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }
    },
    async *stream(_msgs: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) {
        yield chunk
      }
    },
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
    expect(doneEvent).toMatchObject({ type: 'done', inputTokens: 42, outputTokens: 17 })
  })

  it('hard-blocks tool calls outside perimeter and emits audit entry', async () => {
    const auditSink = new InMemoryAuditSink()
    // Provider emits a tool call — perimeter has no connectors so it will be blocked
    const provider = makeMockProvider([
      {
        type: 'tool_call',
        toolName: 'github.list_prs',
        toolCallId: 'tc1',
        args: { resource: 'org/repo' },
      },
      { type: 'done', inputTokens: 10, outputTokens: 5 },
    ])

    // Empty perimeter — no connectors allowed
    const perimeter = AgentPerimeter.resolveCapabilities(
      { userId: UserId('u4'), connectors: [] },
      [],
    )

    const orchestrator = createOrchestrator({
      model: provider,
      tools: [],
      perimeter,
      auditSink,
      sessionMemory: new InMemoryTestMemory(),
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

    // Hard block should produce an error event
    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)

    // tool_call_blocked must appear in audit log
    const blocked = auditSink.events.filter((e) => e.eventType === 'tool_call_blocked')
    expect(blocked.length).toBeGreaterThan(0)
  })
})
