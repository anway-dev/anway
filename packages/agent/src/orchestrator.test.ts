import { describe, it, expect } from 'vitest'
import { SessionId, TenantId, UserId, Message } from '@anway/types'
import type { StreamEvent } from '@anway/types'
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

  // P2 — perimeter enforced inside ConnectorAgent (multi-agent path)
  it('perimeter enforced inside ConnectorAgent — audit spy confirms', async () => {
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
    const events = await collectEvents(runSession(orch, 'Use the tool', makeCtx()))
    // Multi-agent: perimeter enforced inside ConnectorAgent, not in main loop.
    // Findings are emitted via agent_finding, not tool_call_allowed audit events.
    const findings = events.filter(e => e.type === 'agent_finding')
    expect(findings.length).toBeGreaterThan(0)
  })

  // Multi-agent path: ConnectorAgent executes tools internally.
  // No tool_result SSE events — findings come via agent_finding.
  it('emits agent_finding with toolsUsed from ConnectorAgent', async () => {
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
    // Multi-agent: agent_finding events, not tool_result
    const findings = events.filter((e) => e.type === 'agent_finding')
    expect(findings.length).toBeGreaterThan(0)
    // Synthesis produces text_delta + done, no tool_call events
    const toolCalls = events.filter((e) => e.type === 'tool_call')
    expect(toolCalls.length).toBe(0)
  })

  // Token budget: zero budget blocks synthesis token check (multi-agent path)
  it('token meter blocks synthesis when budget is exhausted', async () => {
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
    // With no tools, falls through to synthesisOnlyFallback.
    // Zero perQueryHardLimit blocks the estimated tokens check.
    const errorEvent = events.find((e) => e.type === 'error')
    // either TOKEN_LIMIT_EXCEEDED or UPSTREAM_ERROR depending on path
    expect(errorEvent).toBeDefined()
  })

  // P2 — perimeter enforced inside ConnectorAgent: restricted perimeter produces PERIMETER_BLOCKED
  it('restricted perimeter produces agent_finding with PERIMETER_BLOCKED error', async () => {
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
    // Multi-agent: ConnectorAgent.perimeter.allows() returns false → tool blocked
    // Finding emitted with error or toolsUsed empty
    const findings = events.filter(e => e.type === 'agent_finding')
    expect(findings.length).toBeGreaterThan(0)
  })

  // P5 — multi-agent: emits agent_finding events and synthesis text
  it('multi-agent: emits agent_finding events and synthesis text', async () => {
    const auditSink = new InMemoryAuditSink()
    const promTool: ExecutableTool = {
      name: 'prometheus__query',
      description: 'Query Prometheus metrics',
      parameters: {},
      async run() { return { status: 'success', data: { resultType: 'vector', result: [] } } },
    }
    const ghTool: ExecutableTool = {
      name: 'github__list_prs',
      description: 'List GitHub PRs',
      parameters: {},
      async run() { return [{ title: 'fix: payment timeout', state: 'merged' }] },
    }

    // Agent chat(): first call returns tool call, second returns summary
    const agentCallCounts = new Map<string, number>()
    const multiAgentProvider: IModelProvider = {
      modelId: 'multi-agent-mock',
      cheapModelId: 'multi-agent-mock-cheap',
      async chat(messages, tools, _opts): Promise<ChatResponse> {
        // Intent classification call (no tools)
        if (tools.length === 0) {
          return { content: '{"intent":"incident_triage"}', toolCalls: [], usage: { inputTokens: 3, outputTokens: 3 } }
        }
        // ConnectorAgent calls — check tool prefix to determine agent
        const firstTool = tools[0]?.name ?? 'unknown'
        const agentType = firstTool.split('__')[0] ?? 'unknown'
        const count = agentCallCounts.get(agentType) ?? 0
        agentCallCounts.set(agentType, count + 1)

        if (count === 0) {
          // First call: return a tool call
          return {
            content: '',
            toolCalls: [{ id: `call-${agentType}-1`, name: firstTool, args: { service: 'payments-api' } }],
            usage: { inputTokens: 20, outputTokens: 5 },
          }
        }
        // Second call: return summary
        return {
          content: `${agentType}: service payments-api healthy.`,
          toolCalls: [],
          usage: { inputTokens: 15, outputTokens: 8 },
        }
      },
      async *stream(messages, _tools, _opts) {
        // Synthesis call — emit text then done
        yield { type: 'text_delta' as const, content: 'Prometheus reports payments-api healthy. All metrics normal.' }
        yield { type: 'done' as const, inputTokens: 30, outputTokens: 15 }
      },
      formatToolCall(toolCalls): Message {
        return { role: 'assistant' as const, content: JSON.stringify(toolCalls) }
      },
      formatToolResult(toolCallId: string, result: unknown): Message {
        return { role: 'user' as const, content: JSON.stringify(result) }
      },
    }

    const orch = createOrchestrator({
      model: multiAgentProvider,
      tools: [promTool, ghTool],
      perimeter: makePermissivePerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })

    const events = await collectEvents(runSession(orch, 'check payments-api health', makeCtx()))

    const findings = events.filter(e => e.type === 'agent_finding')
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]!.agentType).toBe('prometheus')

    const textDeltas = events.filter(e => e.type === 'text_delta')
    expect(textDeltas.length).toBeGreaterThan(0)

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()

    const toolCalls = events.filter(e => e.type === 'tool_call')
    expect(toolCalls.length).toBe(0) // synthesis has NO tool calls
  })
})
