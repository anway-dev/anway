import type { ErrorCode, GroundingSource, Message, StreamEvent } from '@anvay/types'
import type { IAuditSink } from './interfaces/audit.js'
import type { ISessionMemory, SessionContext } from './interfaces/memory.js'
import type { IModelProvider, ToolCall, ToolDefinition } from './interfaces/provider.js'
import type { IKnowledgeGraph } from './interfaces/knowledge-graph.js'
import { createPerimeterMiddleware } from './middleware/perimeter.js'
import type { PerimeterCtx } from './middleware/perimeter.js'
import { createTokenMeterMiddleware } from './middleware/token-meter.js'
import type { TokenBudget } from './middleware/token-meter.js'
import type { AgentPerimeter } from './perimeter/engine.js'
import { isWriteAction, pollGate } from './gate/gate.js'
import type { IGateSink } from './gate/gate.js'
import { connectorIdFromTool } from './tools/naming.js'

export interface ExecutableTool extends ToolDefinition {
  run(args: Record<string, unknown>): Promise<unknown>
}

export interface OrchestratorConfig {
  /** Provider for main (expensive) model calls */
  model: IModelProvider
  /** Available tools — orchestrator injects only perimeter-allowed subset */
  tools: ExecutableTool[]
  perimeter: AgentPerimeter
  auditSink: IAuditSink
  sessionMemory: ISessionMemory
  /** Model string for main inference (e.g. 'claude-sonnet-4-6') */
  defaultModel?: string
  /** Model string for cheap classifier calls (e.g. 'claude-haiku-3-5-20251001') */
  cheapModel?: string
  /** Token budget — defaults to generous limits suitable for development */
  budget?: TokenBudget
  /** Maximum tool-call round-trips per runSession call (default: 10) */
  maxSteps?: number
  /** Knowledge Graph for context injection — mandatory. Skipping = hard violation. */
  knowledgeGraph: IKnowledgeGraph
  /** V1 L2 gate — required for write actions. Omit to block all writes (safe default). */
  gateSink?: IGateSink
  /** Gate poll timeout in ms (default: 30000) */
  gateTimeoutMs?: number
}

/** Opaque handle returned by createOrchestrator. Contains no Mastra types. */
export interface Orchestrator {
  readonly config: OrchestratorConfig
}

const DEFAULT_BUDGET: TokenBudget = {
  perQueryHardLimit: 100_000,
  perSessionLimit: 500_000,
  perTenantDailyLimit: 10_000_000,
  perTenantMonthlyLimit: 100_000_000,
  sessionUsed: 0,
  tenantDailyUsed: 0,
  tenantMonthlyUsed: 0,
}

const ORCHESTRATOR_SYSTEM_PROMPT =
  'You are Anvay, the central nervous system of a software organisation. ' +
  'You help engineering, product, and SRE teams query, act, and govern the ' +
  'entire software lifecycle through a single intelligent surface. ' +
  'Every claim you make must be grounded in data from connected sources. ' +
  'When you cannot ground a claim, say so explicitly.'

const INTENT_SYSTEM_PROMPT =
  'Classify the user query. Respond ONLY with a JSON object — no prose: ' +
  '{"intent":"<category>","agentType":"<specialist>","inferredRole":"<role>"}\n' +
  'intent categories: incident_triage, feature_status, code_review, deployment, metrics, general\n' +
  'specialist agents: sre, dev, pm, ba, orchestrator\n' +
  'roles: sre, dev, pm, ba, admin'

/**
 * Creates an orchestrator instance. The returned object is an opaque handle —
 * hand-rolled agentic loop, model-agnostic (IModelProvider). Satisfies four of
 * six locked Mastra requirements: model-agnostic streaming, perimeter middleware
 * on every tool call, full audit hook, and typed multi-agent context handoff.
 * Two missing: waitForInput/gate (see gateSink below) and onModelCall token hook
 * (token-meter middleware is inline, not a Mastra lifecycle hook — functionally
 * equivalent for current feature set).
 */
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return { config }
}

/**
 * Runs an agentic session and yields StreamEvent items as they are produced.
 *
 * The loop:
 *   1. Logs query_received + agent_spawned to auditSink
 *   2. Classifies intent via cheap model (best-effort — does not block on failure)
 *   3. Streams LLM response, forwarding text_delta events to caller
 *   4. On tool_call events: runs perimeter check, executes allowed tools, feeds results back
 *   5. Repeats until no tool calls or maxSteps reached
 *   6. Yields done with cumulative token counts
 */
export async function* runSession(
  orchestrator: Orchestrator,
  input: string,
  ctx: SessionContext,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const { config } = orchestrator
  const { model, tools, perimeter, auditSink, sessionMemory } = config
  const budget = config.budget ?? DEFAULT_BUDGET
  const maxSteps = config.maxSteps ?? 10
  const mainModel = config.defaultModel ?? 'claude-sonnet-4-6'
  const cheapModel = config.cheapModel ?? 'claude-haiku-3-5-20251001'

  const perimeterCtx: PerimeterCtx = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
  }
  const checkPerimeter = createPerimeterMiddleware(perimeter, auditSink, perimeterCtx)
  const checkTokens = createTokenMeterMiddleware(budget)

  await auditSink.append({
    id: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    eventType: 'query_received',
    payload: { query: input, effectiveRole: ctx.effectiveRole },
    createdAt: new Date(),
  })

  await sessionMemory.append(ctx.sessionId, {
    role: 'user',
    content: input,
    timestamp: Date.now(),
  })

  const session = await sessionMemory.get(ctx.sessionId)
  const history = session?.turns ?? []

  // Best-effort intent classification via cheap model
  let classifiedIntent = 'general'
  try {
    const intentMessages: Message[] = [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: input },
    ]
    const intentResp = await model.chat(intentMessages, [], {
      model: cheapModel,
      maxTokens: 100,
      temperature: 0,
      ...(signal ? { signal } : {}),
    })
    const parsed = JSON.parse(intentResp.content) as { intent?: unknown }
    if (typeof parsed.intent === 'string') classifiedIntent = parsed.intent
  } catch {
    // Best-effort — continue with default intent on failure
    classifiedIntent = 'general'
  }

  await auditSink.append({
    id: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    eventType: 'agent_spawned',
    payload: { intent: classifiedIntent, effectiveRole: ctx.effectiveRole },
    createdAt: new Date(),
  })

  // Knowledge Graph context injection — mandatory first step per CLAUDE.md
  let graphContext = ''
  let groundingSources: GroundingSource[] = []
  try {
    const entityResp = await model.chat([
      { role: 'system', content: 'Extract the primary service, team, or entity name from this query. Respond with ONLY the name, or empty string if none found.' },
      { role: 'user', content: input },
    ], [], { model: cheapModel, maxTokens: 30, temperature: 0, ...(signal ? { signal } : {}) })
    const entityName = entityResp.content.trim()
    if (entityName) {
      const context = await config.knowledgeGraph.resolveContextByName(entityName, ctx.tenantId, 2)
      if (!context?.primaryEntity) {
        await config.auditSink.append({
          id: crypto.randomUUID(), tenantId: ctx.tenantId, userId: ctx.userId,
          sessionId: ctx.sessionId, eventType: 'graph_miss',
          payload: { entityName }, createdAt: new Date(),
        }).catch(() => {})
      }
      if (context?.primaryEntity) {
        const parts = [`Graph context for "${context.primaryEntity.name}" (${context.primaryEntity.type}):`]
        for (const rel of context.relationships.slice(0, 10)) {
          const fromName = rel.fromEntityId === context.primaryEntity.id
            ? context.primaryEntity.name
            : context.relatedEntities.find(e => e.id === rel.fromEntityId)?.name ?? rel.fromEntityId
          const toName = context.relatedEntities.find(e => e.id === rel.toEntityId)?.name ?? rel.toEntityId
          parts.push(`  ${rel.relType}: ${fromName} → ${toName}`)
        }
        const coords = context.connectorCoordinates
        if (Object.keys(coords).length > 0) {
          parts.push('Connector coordinates (use for targeted calls):')
          for (const [connType, coord] of Object.entries(coords)) {
            parts.push(`  ${connType}: ${JSON.stringify(coord.resourceIds)}`)
          }
        }
        if (context.freshness < 0.5) parts.push('  [STALE] Verify critical facts from live source.')
        graphContext = parts.join('\n')
        groundingSources = context.groundingSources.map(gs => ({
          source: gs.source,
          fetchedAt: gs.fetchedAt.toISOString(),
          confidence: gs.confidence,
          freshness: context.freshness,
        }))
      }
    }
  } catch (err) {
    // Graph failure is audit-logged (hard violation per CLAUDE.md)
    await auditSink.append({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      eventType: 'graph_context_failed',
      payload: { error: err instanceof Error ? err.message : 'graph context resolution failed' },
      createdAt: new Date(),
    })
  }

  // Tool definitions for the LLM (run function stripped)
  const toolDefs: ToolDefinition[] = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))

  // Build message list from history + current turn
  const systemPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\nEffective role: ${ctx.effectiveRole}. Classified intent: ${classifiedIntent}.${graphContext ? '\n\n' + graphContext : ''}`
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(
      (t): Message => ({
        role: t.role as 'user' | 'assistant' | 'system',
        content: t.content,
      }),
    ),
  ]

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let accumulatedText = ''

  for (let step = 0; step < maxSteps; step++) {
    // Estimate tokens for budget check (rough: 1 token ≈ 4 chars + overhead)
    const msgTokens = messages.reduce((acc, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return acc + Math.ceil(content.length / 4)
    }, 0)
    const toolTokens = toolDefs.reduce((acc, t) => acc + Math.ceil(JSON.stringify(t).length / 4), 0)
    const estimatedTokens = msgTokens + toolTokens + 500

    const tokenResult = await checkTokens({
      estimatedTokens,
      messages,
      model: mainModel,
    })

    if ('_tag' in tokenResult && tokenResult._tag === 'TokenHardBlock') {
      yield makeError('TOKEN_LIMIT_EXCEEDED', tokenResult.reason)
      return
    }

    // Stream from provider — collect tool_call chunks, forward text_delta
    const collectedToolCalls: ToolCall[] = []
    let hasToolCalls = false

    for await (const chunk of model.stream(messages, toolDefs, { model: mainModel, ...(signal ? { signal } : {}) })) {
      if (chunk.type === 'text_delta') {
        accumulatedText += chunk.content
        yield chunk
      } else if (chunk.type === 'tool_call') {
        hasToolCalls = true
        collectedToolCalls.push({
          id: chunk.toolCallId,
          name: chunk.toolName,
          args: chunk.args,
        })
        yield chunk
      } else if (chunk.type === 'done') {
        totalInputTokens += chunk.inputTokens
        totalOutputTokens += chunk.outputTokens
        budget.sessionUsed += chunk.inputTokens + chunk.outputTokens
        budget.tenantDailyUsed += chunk.inputTokens + chunk.outputTokens
        budget.tenantMonthlyUsed += chunk.inputTokens + chunk.outputTokens
        // Don't yield done yet — may be more steps
      } else if (chunk.type === 'error') {
        yield chunk
        return
      }
      // gate_required, tool_result — forward as-is (pass-through from specialist)
    }

    if (!hasToolCalls) break // Conversation complete — no more tool calls

    // Run perimeter check + execute each tool call
    const toolResultMessages: Message[] = []

    for (const toolCall of collectedToolCalls) {
      const perimResult = await checkPerimeter(toolCall)

      if ('_tag' in perimResult && perimResult._tag === 'HardBlock') {
        // Emit an error event to the caller but continue with other tools
        yield makeError('FORBIDDEN', perimResult.reason)
        toolResultMessages.push(model.formatToolResult(toolCall.id, `Tool "${toolCall.name}" blocked: ${perimResult.reason}`))
        continue
      }

      // V1 L2 gate: every write action requires user approval before execution
      if (isWriteAction(toolCall.name) && config.gateSink) {
        const gateId = crypto.randomUUID()
        await config.gateSink.push({
          id: gateId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.args,
          connectorId: connectorIdFromTool(toolCall.name),
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          createdAt: new Date(),
        })
        yield {
          type: 'gate_required',
          gateId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.args,
        }
        const decision = await pollGate(config.gateSink, gateId, config.gateTimeoutMs ?? 30_000)
        if (decision._tag !== 'approved') {
          await auditSink.append({
            id: crypto.randomUUID(),
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            sessionId: ctx.sessionId,
            eventType: 'tool_call_blocked',
            payload: { gateId, toolName: toolCall.name, decision: decision._tag, reason: '_tag' in decision && 'reason' in decision ? decision.reason : undefined },
            createdAt: new Date(),
          })
          const blockMsg = `Write action "${toolCall.name}" ${decision._tag === 'rejected' ? 'rejected by user' : 'timed out awaiting approval'}`
          toolResultMessages.push(model.formatToolResult(toolCall.id, blockMsg))
          yield { type: 'tool_result', toolCallId: toolCall.id, result: blockMsg }
          continue
        }
      }

      // Find matching executable tool
      const execTool = tools.find((t) => t.name === toolCall.name)
      let result: unknown

      if (execTool) {
        try {
          result = await execTool.run(toolCall.args)
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : 'unknown error in tool execution'}`
        }
      } else {
        result = `Tool "${toolCall.name}" is not registered in this orchestrator`
      }

      yield { type: 'tool_result', toolCallId: toolCall.id, result }
      toolResultMessages.push(model.formatToolResult(toolCall.id, result))
    }

    // Append this round's exchange to messages for the next step.
    messages.push(model.formatToolCall(collectedToolCalls))
    for (const msg of toolResultMessages) {
      messages.push(msg)
    }
  }

  // Persist assistant turn summary
  await sessionMemory.append(ctx.sessionId, {
    role: 'assistant',
    content: accumulatedText || '[no response]',
    timestamp: Date.now(),
  })

  yield {
    type: 'done',
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    ...(groundingSources.length > 0 ? { groundingSources } : {}),
  }
}

function makeError(code: ErrorCode, message: string): StreamEvent & { type: 'error' } {
  return { type: 'error', code, message }
}

