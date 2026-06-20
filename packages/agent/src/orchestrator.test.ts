import { describe, it, expect } from 'vitest'
import { SessionId, TenantId, UserId, Message } from '@anvay/types'
import type { StreamEvent } from '@anvay/types'
import type { IAuditSink, AuditEvent } from './interfaces/audit.js'
import type { IModelProvider, ChatResponse } from './interfaces/provider.js'
import type { ISessionMemory, SessionContext, ConversationTurn } from './interfaces/memory.js'
import { AgentPerimeter } from './perimeter/engine.js'
import type { UserPerimeter, ConnectorManifest } from './perimeter/engine.js'
import type { TokenBudget } from './middleware/token-meter.js'
import { createOrchestrator, runSession } from './orchestrator.js'
import type { ExecutableTool } from './orchestrator.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class InMemoryAuditSink implements IAuditSink {
  readonly events: AuditEvent[] = []
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event)
  }
}

class InMemorySessionMemory implements ISessionMemory {
  private readonly store = new Map<string, ConversationTurn[]>()

  async get(sessionId: SessionId): Promise<SessionContext | null> {
    const turns = this.store.get(sessionId as string) ?? []
    return {
      sessionId,
      userId: UserId('test-user'),
      tenantId: TenantId('test-tenant'),
      effectiveRole: 'dev',
      turns,
    }
  }

  async append(sessionId: SessionId, turn: ConversationTurn): Promise<void> {
    const existing = this.store.get(sessionId as string) ?? []
    this.store.set(sessionId as string, [...existing, turn])
  }

  async summarise(_sessionId: SessionId): Promise<void> {}
  async clear(sessionId: SessionId): Promise<void> {
    this.store.delete(sessionId as string)
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

function makePermissivePerimeter(): AgentPerimeter {
  const userPerimeter: UserPerimeter = {
    userId: UserId('test-user'),
    connectors: [{ connectorId: 'test-connector', read: ['*'], write: ['*'] }],
  }
  const manifests: ConnectorManifest[] = [
    {
      connectorId: 'test-connector',
      mode: 'read-write',
      capabilities: { read: ['*'], write: ['*'] },
    },
  ]
  return new AgentPerimeter(userPerimeter, manifests)
}

function makeRestrictedPerimeter(): AgentPerimeter {
  // No connectors — all tool calls blocked
  return new AgentPerimeter(
    { userId: UserId('restricted-user'), connectors: [] },
    [],
  )
}

function makeCtx(sessionId = 'test-session'): SessionContext {
  return {
    sessionId: SessionId(sessionId),
    userId: UserId('test-user'),
    tenantId: TenantId('test-tenant'),
    effectiveRole: 'dev',
    turns: [],
  }
}

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of gen) {
    events.push(event)
  }
  return events
}

// ---------------------------------------------------------------------------
// Mock provider factories
// ---------------------------------------------------------------------------

/** Provider that returns one text_delta + done, no tool calls */
function makeTextOnlyProvider(): IModelProvider {
  return {
    modelId: 'mock-model',
    cheapModelId: 'mock-model-cheap',
    async chat(_messages, _tools, _opts): Promise<ChatResponse> {
      return { content: '{"intent":"general"}', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }
    },
    async *stream(_messages, _tools, _opts) {
      yield { type: 'text_delta', content: 'Hello from mock!' }
      yield { type: 'done', inputTokens: 20, outputTokens: 10 }
    },
    formatToolCall(_toolCalls: import('./interfaces/provider.js').ToolCall[]): Message {
      return { role: 'assistant', content: '' }
    },
    formatToolResult(_toolCallId: string, _result: unknown): Message {
      return { role: 'user', content: '' }
    },
  }
}

/** Provider that calls a tool once, then responds with text */
function makeToolCallProvider(toolName: string): IModelProvider {
  let callCount = 0
  return {
    modelId: 'mock-model',
    cheapModelId: 'mock-model-cheap',
    async chat(_messages, _tools, _opts): Promise<ChatResponse> {
      // Intent classification call
      return { content: '{"intent":"general"}', toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 } }
    },
    async *stream(_messages, _tools, _opts) {
      callCount++
      if (callCount === 1) {
        // First stream call — emit a tool call
        yield { type: 'tool_call', toolName, toolCallId: 'call-001', args: { resource: 'test-connector/resource-1' } }
        yield { type: 'done', inputTokens: 30, outputTokens: 5 }
      } else {
        // Second stream call (after tool results injected) — emit text response
        yield { type: 'text_delta', content: 'Tool executed successfully.' }
        yield { type: 'done', inputTokens: 40, outputTokens: 15 }
      }
    },
    formatToolCall(_toolCalls: import('./interfaces/provider.js').ToolCall[]): Message {
      return { role: 'assistant', content: '' }
    },
    formatToolResult(_toolCallId: string, _result: unknown): Message {
      return { role: 'user', content: JSON.stringify(_result) }
    },
  }
}

describe('createOrchestrator', () => {
  it('returns an orchestrator with the provided config', () => {
    const model = makeTextOnlyProvider()
    const auditSink = new InMemoryAuditSink()
    const sessionMemory = new InMemorySessionMemory()
    const perimeter = makePermissivePerimeter()
    const orch = createOrchestrator({ model, tools: [], perimeter, auditSink, sessionMemory, knowledgeGraph: makeMockKG() })
    expect(orch).toBeDefined()
    expect(orch.config.model).toBe(model)
  })
})

describe('runSession', () => {
  it('caps the agentic loop at maxSteps and emits one done event', async () => {
    let callCount = 0
    const loopingProvider: IModelProvider = {
      modelId: 'mock-model',
      cheapModelId: 'mock-model-cheap',
      async chat(): Promise<ChatResponse> {
        return { content: '{"intent":"general"}', toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 } }
      },
      async *stream() {
        callCount++
        yield { type: 'tool_call', toolName: 'test-connector.action', toolCallId: `call-${callCount}`, args: { resource: 'test-connector/x' } }
        yield { type: 'done', inputTokens: 10, outputTokens: 5 }
      },
      formatToolResult(_toolCallId: string, result: unknown): Message {
        return { role: 'user', content: JSON.stringify(result) }
      },
      formatToolCall(_toolCalls: import('./interfaces/provider.js').ToolCall[]): Message {
        return { role: 'assistant', content: '' }
      },
    }

    const execTool: ExecutableTool = {
      name: 'test-connector.action',
      description: 'Always loops',
      parameters: {},
      async run() {
        return 'done'
      },
    }

    const orch = createOrchestrator({
      model: loopingProvider,
      tools: [execTool],
      perimeter: makePermissivePerimeter(),
      auditSink: new InMemoryAuditSink(),
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
      maxSteps: 3,
    })

    const events = await collectEvents(runSession(orch, 'Loop test', makeCtx()))
    expect(callCount).toBeLessThanOrEqual(3)
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
  })

  it('yields text_delta and done events from a mock provider', async () => {
    const auditSink = new InMemoryAuditSink()
    const orch = createOrchestrator({
      model: makeTextOnlyProvider(),
      tools: [],
      perimeter: makePermissivePerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })
    const events = await collectEvents(runSession(orch, 'Hello', makeCtx()))
    const textEvents = events.filter((e) => e.type === 'text_delta')
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(textEvents.length).toBeGreaterThan(0)
    expect(doneEvents).toHaveLength(1)
    if (doneEvents[0]?.type === 'done') {
      expect(doneEvents[0].inputTokens).toBeGreaterThanOrEqual(0)
      expect(doneEvents[0].outputTokens).toBeGreaterThanOrEqual(0)
    }
  })

  it('logs query_received and agent_spawned audit events', async () => {
    const auditSink = new InMemoryAuditSink()
    const orch = createOrchestrator({
      model: makeTextOnlyProvider(),
      tools: [],
      perimeter: makePermissivePerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })
    await collectEvents(runSession(orch, 'Test query', makeCtx()))
    const types = auditSink.events.map((e) => e.eventType)
    expect(types).toContain('query_received')
    expect(types).toContain('agent_spawned')
  })

  it('perimeter middleware fires on tool call - audit spy confirms', async () => {
    const toolName = 'test-connector.read_data'
    const auditSink = new InMemoryAuditSink()
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Test tool',
      parameters: {},
      async run() { return { data: 'result' } },
    }
    const orch = createOrchestrator({
      model: makeToolCallProvider(toolName),
      tools: [execTool],
      perimeter: makePermissivePerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })
    await collectEvents(runSession(orch, 'Use the tool', makeCtx()))
    const perimEvents = auditSink.events.filter(
      (e) => e.eventType === 'tool_call_allowed' || e.eventType === 'tool_call_blocked',
    )
    expect(perimEvents.length).toBeGreaterThan(0)
  })

  it('yields tool_result event after tool execution', async () => {
    const toolName = 'test-connector.fetch_data'
    const auditSink = new InMemoryAuditSink()
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Fetches data',
      parameters: {},
      async run() { return { rows: [1, 2, 3] } },
    }
    const orch = createOrchestrator({
      model: makeToolCallProvider(toolName),
      tools: [execTool],
      perimeter: makePermissivePerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })
    const events = await collectEvents(runSession(orch, 'Fetch data', makeCtx()))
    const toolResultEvents = events.filter((e) => e.type === 'tool_result')
    expect(toolResultEvents.length).toBeGreaterThan(0)
  })

  it('token meter blocks when budget is exhausted', async () => {
    const zeroBudget: TokenBudget = {
      perQueryHardLimit: 0,
      perSessionLimit: 1_000_000,
      perTenantDailyLimit: 100_000_000,
      perTenantMonthlyLimit: 1_000_000_000,
      sessionUsed: 0,
      tenantDailyUsed: 0,
      tenantMonthlyUsed: 0,
    }
    const orch = createOrchestrator({
      model: makeTextOnlyProvider(),
      tools: [],
      perimeter: makePermissivePerimeter(),
      auditSink: new InMemoryAuditSink(),
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
      budget: zeroBudget,
    })
    const events = await collectEvents(runSession(orch, 'Query with exhausted budget', makeCtx()))
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('TOKEN_LIMIT_EXCEEDED')
    }
  })

  it('blocks tool calls outside perimeter and emits FORBIDDEN error', async () => {
    const toolName = 'blocked-connector.read_data'
    const auditSink = new InMemoryAuditSink()
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Blocked tool',
      parameters: {},
      async run() { return 'should not reach here' },
    }
    const orch = createOrchestrator({
      model: makeToolCallProvider(toolName),
      tools: [execTool],
      perimeter: makeRestrictedPerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })
    const events = await collectEvents(runSession(orch, 'Do something blocked', makeCtx()))
    const forbiddenEvents = events.filter(
      (e) => e.type === 'error' && e.code === 'FORBIDDEN',
    )
    expect(forbiddenEvents.length).toBeGreaterThan(0)
    const blockedEvents = auditSink.events.filter((e) => e.eventType === 'tool_call_blocked')
    expect(blockedEvents.length).toBeGreaterThan(0)
  })
})
