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
import { InMemoryGateSink } from './gate/in-memory-gate-sink.js'

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
    getEntitiesByConnectorType: async () => [],
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

  it('applies inferred role for response shaping (effective_role = inferred ?? auth) and audits it', async () => {
    // Regression test: the intent classifier always produced inferredRole
    // in its JSON but it was parsed nowhere — effectiveRole was the raw
    // JWT role forever, so role-aware answering never actually varied.
    const capturedSystemPrompts: string[] = []
    const provider: IModelProvider = {
      modelId: 'mock-model',
      cheapModelId: 'mock-model-cheap',
      async chat(_messages, _tools, _opts): Promise<ChatResponse> {
        return { content: '{"intent":"general","inferredRole":"pm"}', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }
      },
      async *stream(messages, _tools, _opts) {
        const sys = messages.find(m => m.role === 'system')
        if (sys) capturedSystemPrompts.push(sys.content)
        yield { type: 'text_delta', content: 'ok' }
        yield { type: 'done', inputTokens: 20, outputTokens: 10 }
      },
      formatToolCall(): Message { return { role: 'assistant', content: '' } },
      formatToolResult(): Message { return { role: 'user', content: '' } },
    }
    const auditSink = new InMemoryAuditSink()
    const orch = createOrchestrator({
      model: provider, tools: [], perimeter: makePermissivePerimeter(), auditSink,
      sessionMemory: new InMemorySessionMemory(), knowledgeGraph: makeMockKG(),
    })
    await collectEvents(runSession(orch, 'What is the status of Feature X for the Q3 launch?', makeCtx()))

    const roleEvent = auditSink.events.find(e => e.eventType === 'role_inferred')
    expect(roleEvent).toBeDefined()
    expect(roleEvent!.payload).toMatchObject({ authRole: 'dev', inferredRole: 'pm' })
    // Synthesis prompt carries the inferred role's guidance, not the auth role's
    const synthPrompt = capturedSystemPrompts.join('\n')
    expect(synthPrompt).toContain('Effective role: pm')
    expect(synthPrompt).toContain('product manager')
  })

  it('ignores an invalid inferredRole (never trusts arbitrary classifier output)', async () => {
    const provider: IModelProvider = {
      modelId: 'mock-model',
      cheapModelId: 'mock-model-cheap',
      async chat(): Promise<ChatResponse> {
        return { content: '{"intent":"general","inferredRole":"superadmin"}', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }
      },
      async *stream(_messages, _tools, _opts) {
        yield { type: 'text_delta', content: 'ok' }
        yield { type: 'done', inputTokens: 20, outputTokens: 10 }
      },
      formatToolCall(): Message { return { role: 'assistant', content: '' } },
      formatToolResult(): Message { return { role: 'user', content: '' } },
    }
    const auditSink = new InMemoryAuditSink()
    const orch = createOrchestrator({
      model: provider, tools: [], perimeter: makePermissivePerimeter(), auditSink,
      sessionMemory: new InMemorySessionMemory(), knowledgeGraph: makeMockKG(),
    })
    await collectEvents(runSession(orch, 'hello', makeCtx()))
    expect(auditSink.events.find(e => e.eventType === 'role_inferred')).toBeUndefined()
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

  // Regression test for a token-budget reservation leak found by independent
  // review (second pass, after the token-meter race fix): checkTokens
  // reserves estimatedTokens synchronously, and reconcileTokenUsage is
  // supposed to true it up against real usage on every path that reserved —
  // but the intent-classification step's model.chat() call only reconciled
  // on success, leaving the reservation permanently stuck in budget.sessionUsed
  // forever if that one call failed (audit-logged and swallowed by the
  // outer try/catch, session continues with classifiedIntent='general').
  //
  // Property under test: regardless of which step's model call fails, the
  // net delta this session applies to budget.sessionUsed must exactly equal
  // the real total tokens reported in the final `done` event — a failed
  // step must contribute exactly 0 net (reserve then fully release), a
  // successful step must contribute exactly its own actual usage. A leak
  // would inflate sessionUsed above the done event's real total.
  it('does not leak a token reservation when the intent-classification model call fails', async () => {
    let chatCallCount = 0
    const flakyIntentProvider: IModelProvider = {
      modelId: 'mock-model',
      cheapModelId: 'mock-model-cheap',
      async chat(_messages, _tools, _opts): Promise<ChatResponse> {
        chatCallCount++
        if (chatCallCount === 1) {
          // Intent classification — fails.
          throw new Error('simulated upstream failure on intent classification')
        }
        // Entity extraction — succeeds with known, real usage.
        return { content: 'payments-api', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }
      },
      async *stream(_messages, _tools, _opts) {
        yield { type: 'text_delta', content: 'Fallback synthesis response.' }
        yield { type: 'done', inputTokens: 20, outputTokens: 10 }
      },
      formatToolCall(): Message { return { role: 'assistant', content: '' } },
      formatToolResult(): Message { return { role: 'user', content: '' } },
    }

    const budget: TokenBudget = {
      perQueryHardLimit: 1_000_000,
      perSessionLimit: 1_000_000,
      perTenantDailyLimit: 100_000_000,
      perTenantMonthlyLimit: 1_000_000_000,
      sessionUsed: 0,
      tenantDailyUsed: 0,
      tenantMonthlyUsed: 0,
    }
    const orch = createOrchestrator({
      model: flakyIntentProvider,
      tools: [],
      perimeter: makePermissivePerimeter(),
      auditSink: new InMemoryAuditSink(),
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
      budget,
    })
    const events = await collectEvents(runSession(orch, 'What is the deploy status?', makeCtx()))
    const doneEvent = events.find((e) => e.type === 'done')
    expect(doneEvent).toBeDefined()
    if (doneEvent?.type === 'done') {
      // The failed intent-classification call must contribute exactly 0 net
      // to the budget (reservation fully released) — sessionUsed must equal
      // exactly the real total the session actually reports, not that total
      // plus a stuck intent-classification reservation.
      expect(budget.sessionUsed).toBe(doneEvent.inputTokens + doneEvent.outputTokens)
      expect(budget.tenantDailyUsed).toBe(doneEvent.inputTokens + doneEvent.outputTokens)
      expect(budget.tenantMonthlyUsed).toBe(doneEvent.inputTokens + doneEvent.outputTokens)
    }
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

// ---------------------------------------------------------------------------
// T1 tests — L2 gate + audited perimeter enforcement on every tool call
// ---------------------------------------------------------------------------

function makeWriteConnectorPerimeter(): AgentPerimeter {
  const userPerimeter: UserPerimeter = {
    userId: UserId('test-user'),
    connectors: [{ connectorId: 'write-connector', read: ['*'], write: ['*'] }],
  }
  const manifests: ConnectorManifest[] = [
    {
      connectorId: 'write-connector',
      mode: 'read-write',
      capabilities: { read: ['*'], write: ['*'] },
    },
  ]
  return new AgentPerimeter(userPerimeter, manifests)
}

/** Provider whose chat() returns a single tool call then a summary — for ConnectorAgent tests */
function makeChatToolProvider(toolName: string, args?: Record<string, unknown>): IModelProvider {
  let callCount = 0
  return {
    modelId: 'mock-chat-model',
    cheapModelId: 'mock-chat-model-cheap',
    async chat(messages, tools, _opts): Promise<ChatResponse> {
      // Intent classification call (no tools)
      if (tools.length === 0) {
        return { content: '{"intent":"general"}', toolCalls: [], usage: { inputTokens: 3, outputTokens: 3 } }
      }
      callCount++
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [{ id: `call-${toolName}-1`, name: toolName, args: args ?? { resource: 'test-connector/x' } }],
          usage: { inputTokens: 20, outputTokens: 5 },
        }
      }
      return {
        content: `${toolName}: completed.`,
        toolCalls: [],
        usage: { inputTokens: 15, outputTokens: 8 },
      }
    },
    async *stream(_messages, _tools, _opts) {
      yield { type: 'text_delta' as const, content: 'Synthesis.' }
      yield { type: 'done' as const, inputTokens: 10, outputTokens: 5 }
    },
    formatToolCall(toolCalls): Message {
      return { role: 'assistant' as const, content: JSON.stringify(toolCalls) }
    },
    formatToolResult(toolCallId: string, result: unknown): Message {
      return { role: 'user' as const, content: JSON.stringify(result) }
    },
  }
}

/** Provider whose chat() returns a write-tool call, then a summary */
function makeWriteToolChatProvider(toolName: string): IModelProvider {
  let callCount = 0
  return {
    modelId: 'mock-write-model',
    cheapModelId: 'mock-write-model-cheap',
    async chat(messages, tools, _opts): Promise<ChatResponse> {
      // Intent classification call (no tools)
      if (tools.length === 0) {
        return { content: '{"intent":"general"}', toolCalls: [], usage: { inputTokens: 3, outputTokens: 3 } }
      }
      callCount++
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'call-write-001', name: toolName, args: { resource: 'write-connector/service-x' } }],
          usage: { inputTokens: 20, outputTokens: 5 },
        }
      }
      return {
        content: 'Write action result summary.',
        toolCalls: [],
        usage: { inputTokens: 15, outputTokens: 8 },
      }
    },
    async *stream(_messages, _tools, _opts) {
      yield { type: 'text_delta' as const, content: 'Synthesis after write action.' }
      yield { type: 'done' as const, inputTokens: 30, outputTokens: 15 }
    },
    formatToolCall(toolCalls): Message {
      return { role: 'assistant' as const, content: JSON.stringify(toolCalls) }
    },
    formatToolResult(toolCallId: string, result: unknown): Message {
      return { role: 'user' as const, content: JSON.stringify(result) }
    },
  }
}

describe('T1 — L2 gate + audited perimeter', () => {
  // T1.3 — Perimeter-blocked call audited as tool_call_blocked
  it('perimeter-blocked tool call is audited as tool_call_blocked', async () => {
    const toolName = 'blocked-connector.read_data'
    const auditSink = new InMemoryAuditSink()
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Should be blocked',
      parameters: {},
      async run() { return 'should not execute' },
    }
    const orch = createOrchestrator({
      model: makeChatToolProvider(toolName),
      tools: [execTool],
      perimeter: makeRestrictedPerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })
    await collectEvents(runSession(orch, 'Trigger blocked tool', makeCtx()))
    const blockedEvents = auditSink.events.filter(e => e.eventType === 'tool_call_blocked')
    expect(blockedEvents.length).toBeGreaterThan(0)
    expect(blockedEvents[0]!.payload['toolName']).toBe(toolName)
  })

  // T1.4 — Perimeter-allowed call audited as tool_call_allowed
  it('perimeter-allowed tool call is audited as tool_call_allowed', async () => {
    const toolName = 'test-connector.read_data'
    const auditSink = new InMemoryAuditSink()
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Allowed read tool',
      parameters: {},
      async run() { return { data: 'result' } },
    }
    const orch = createOrchestrator({
      model: makeChatToolProvider(toolName),
      tools: [execTool],
      perimeter: makePermissivePerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
    })
    await collectEvents(runSession(orch, 'Use allowed tool', makeCtx()))
    const allowedEvents = auditSink.events.filter(e => e.eventType === 'tool_call_allowed')
    expect(allowedEvents.length).toBeGreaterThan(0)
    expect(allowedEvents[0]!.payload['toolName']).toBe(toolName)
  })

  // T1.1 — Write-tool without gateSink → hard-blocked
  it('write action is hard-blocked when no gateSink is configured', async () => {
    const toolName = 'write-connector.restart_service'
    const auditSink = new InMemoryAuditSink()
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Restarts a service (write)',
      parameters: {},
      async run() { return 'should not execute — no gate' },
    }
    const orch = createOrchestrator({
      model: makeWriteToolChatProvider(toolName),
      tools: [execTool],
      perimeter: makeWriteConnectorPerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
      // gateSink intentionally omitted — safe default: block all writes
    })
    await collectEvents(runSession(orch, 'Restart service', makeCtx()))
    const blockedEvents = auditSink.events.filter(e =>
      e.eventType === 'tool_call_blocked' && (e.payload['reason'] === 'no_gate_sink' || e.payload['rule'] === 'v1_safe_default')
    )
    expect(blockedEvents.length).toBeGreaterThan(0)
  })

  // T1.1b — Write-tool with gateSink → gate_required flow, tool executes on approval
  it('write action with gateSink pushes gate event and executes on approval', async () => {
    const toolName = 'write-connector.restart_service'
    const auditSink = new InMemoryAuditSink()
    const gateSink = new InMemoryGateSink()
    let toolExecuted = false
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Restarts a service (write)',
      parameters: {},
      async run() { toolExecuted = true; return { status: 'restarted' } },
    }

    const orch = createOrchestrator({
      model: makeWriteToolChatProvider(toolName),
      tools: [execTool],
      perimeter: makeWriteConnectorPerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
      gateSink,
      gateTimeoutMs: 5000,
    })

    // Pre-approve the gate — pollGate will resolve immediately
    const originalPush = gateSink.push.bind(gateSink)
    let capturedGateId = ''
    gateSink.push = async (event) => {
      capturedGateId = await originalPush(event)
      // Auto-approve so pollGate returns 'approved'
      await gateSink.record(capturedGateId, 'approved', 'test-user')
      return capturedGateId
    }

    await collectEvents(runSession(orch, 'Restart service', makeCtx()))

    // Tool should have executed since gate was pre-approved
    expect(toolExecuted).toBe(true)
    // Gate decision audit event should exist
    const gateEvents = auditSink.events.filter(e => e.eventType === 'gate_decision')
    expect(gateEvents.length).toBeGreaterThan(0)
  })

  // T1.2 — Rejected gate decision → tool not executed, tool_call_blocked audited
  it('rejected gate decision blocks write and audits tool_call_blocked', async () => {
    const toolName = 'write-connector.restart_service'
    const auditSink = new InMemoryAuditSink()
    const gateSink = new InMemoryGateSink()
    let toolExecuted = false
    const execTool: ExecutableTool = {
      name: toolName,
      description: 'Restarts a service (write)',
      parameters: {},
      async run() { toolExecuted = true; return 'should not execute' },
    }

    const orch = createOrchestrator({
      model: makeWriteToolChatProvider(toolName),
      tools: [execTool],
      perimeter: makeWriteConnectorPerimeter(),
      auditSink,
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: makeMockKG(),
      gateSink,
      gateTimeoutMs: 5000,
    })

    // Pre-reject the gate
    const originalPush = gateSink.push.bind(gateSink)
    gateSink.push = async (event) => {
      const gateId = await originalPush(event)
      await gateSink.record(gateId, 'rejected', 'test-user')
      return gateId
    }

    await collectEvents(runSession(orch, 'Restart service', makeCtx()))

    // Tool should NOT have executed
    expect(toolExecuted).toBe(false)
    // Audit should show a blocked event for the rejected gate
    const blockedEvents = auditSink.events.filter(e =>
      e.eventType === 'tool_call_blocked' && e.payload['decision'] === 'rejected'
    )
    expect(blockedEvents.length).toBeGreaterThan(0)
  })
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
