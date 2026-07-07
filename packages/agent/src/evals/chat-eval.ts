import { SessionId, TenantId, UserId } from '@anway/types'
import type { StreamEvent } from '@anway/types'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IAuditSink, AuditEvent } from '../interfaces/audit.js'
import type { ISessionMemory, SessionContext, ConversationTurn } from '../interfaces/memory.js'
import type { IKnowledgeGraph } from '../interfaces/knowledge-graph.js'
import { AgentPerimeter } from '../perimeter/engine.js'
import { createOrchestrator, runSession } from '../orchestrator.js'
import { judge } from './judge.js'
import type { EvalResult } from './types.js'

class InMemoryAuditSink implements IAuditSink {
  async append(_event: AuditEvent): Promise<void> {}
}

class InMemorySessionMemory implements ISessionMemory {
  private readonly store = new Map<string, ConversationTurn[]>()
  async get(sessionId: SessionId): Promise<SessionContext | null> {
    return {
      sessionId,
      userId: UserId('eval-user'),
      tenantId: TenantId('eval-tenant'),
      effectiveRole: 'dev',
      turns: this.store.get(sessionId as string) ?? [],
    }
  }
  async append(sessionId: SessionId, turn: ConversationTurn): Promise<void> {
    const existing = this.store.get(sessionId as string) ?? []
    this.store.set(sessionId as string, [...existing, turn])
  }
  async summarise(): Promise<void> {}
  async clear(sessionId: SessionId): Promise<void> { this.store.delete(sessionId as string) }
}

// No connectors registered — deliberately exercises the orchestrator's
// synthesisOnlyFallback path (the "no connector matched" branch), which
// per this session's earlier fix is the most common real query shape
// (general questions with no specific service/tool match) and previously
// had zero eval coverage at all — confirmed live via independent review
// (finding I8: "none for the primary chat path"). Every prior eval case in
// this suite exercised a single specialist agent method directly
// (ProductAgent.writePRD, SREAgent.assembleContext, etc.), never the real
// user-facing entry point (runSession) that actually classifies intent,
// resolves graph context, and synthesizes a grounded response.
function makeEmptyPerimeter(): AgentPerimeter {
  return new AgentPerimeter({ userId: UserId('eval-user'), connectors: [] }, [])
}

const noopGraph: IKnowledgeGraph = {
  resolveContextByName: async () => null,
  resolveContext: async () => { throw new Error('not used — no entity resolved in this eval') },
  upsertEntity: async () => 'noop-id',
  upsertRelationship: async () => 'noop-rel-id',
  addEpisode: async () => {},
  getFacts: async () => [],
  getEntity: async () => null,
  getRelationships: async () => [],
  search: async () => [],
  markConnectorEntitiesStale: async () => 0,
  getEntityByExternalRef: async () => null,
  deleteEntitiesByOrgPrefix: async () => 0,
}

/**
 * Runs a real query through the actual primary chat entry point
 * (createOrchestrator + runSession) — the code path every real user
 * request goes through — end to end with a real model, real perimeter
 * resolution, and real streaming, then judges the synthesized response
 * against the given rubric. No tools are registered, so this exercises the
 * synthesisOnlyFallback branch specifically (see comment above).
 */
export async function runChatEval(
  model: IModelProvider,
  judgeModel: IModelProvider,
  id: string,
  input: string,
  rubric: string,
): Promise<EvalResult> {
  try {
    const orchestrator = createOrchestrator({
      model,
      tools: [],
      perimeter: makeEmptyPerimeter(),
      auditSink: new InMemoryAuditSink(),
      sessionMemory: new InMemorySessionMemory(),
      knowledgeGraph: noopGraph,
    })

    const ctx: SessionContext = {
      sessionId: SessionId(`eval-${id}`),
      userId: UserId('eval-user'),
      tenantId: TenantId('eval-tenant'),
      effectiveRole: 'dev',
      turns: [],
    }

    let accumulatedText = ''
    let sawError: string | null = null
    for await (const event of runSession(orchestrator, input, ctx) as AsyncGenerator<StreamEvent>) {
      if (event.type === 'text_delta') accumulatedText += event.content
      if (event.type === 'error') sawError = event.message
    }

    if (sawError) {
      return { id, agentAction: 'runSession (chat path)', score: 0, passed: false, reasoning: `runSession emitted an error event: ${sawError}`, rawOutput: null }
    }

    return judge(judgeModel, id, 'runSession (chat path)', rubric, { response: accumulatedText })
  } catch (e) {
    return {
      id, agentAction: 'runSession (chat path)', score: 0, passed: false,
      reasoning: `runSession threw before producing output: ${e instanceof Error ? e.message : String(e)}`,
      rawOutput: null,
    }
  }
}
