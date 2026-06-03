import type { ErrorCode, Message, StreamEvent } from '@anvay/types'
import type { IAuditSink } from './interfaces/audit.js'
import type { ISessionMemory, SessionContext } from './interfaces/memory.js'
import type { IModelProvider, ToolCall, ToolDefinition } from './interfaces/provider.js'
import { createPerimeterMiddleware } from './middleware/perimeter.js'
import type { PerimeterCtx } from './middleware/perimeter.js'
import { createTokenMeterMiddleware } from './middleware/token-meter.js'
import type { TokenBudget } from './middleware/token-meter.js'
import type { AgentPerimeter } from './perimeter/engine.js'

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
 * no Mastra types are exposed to the caller.
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
    })
    const parsed = JSON.parse(intentResp.content) as { intent?: unknown }
    if (typeof parsed.intent === 'string') classifiedIntent = parsed.intent
  } catch {
    // Not a hard failure — proceed with default intent
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

  // Tool definitions for the LLM (run function stripped)
  const toolDefs: ToolDefinition[] = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))

  // Build message list from history + current turn
  const systemPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\nEffective role: ${ctx.effectiveRole}. Classified intent: ${classifiedIntent}.`
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

  for (let step = 0; step < maxSteps; step++) {
    // Estimate tokens for budget check (rough: 1 token ≈ 4 chars + overhead)
    const estimatedTokens =
      messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0) + 500

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

    for await (const chunk of model.stream(messages, toolDefs, { model: mainModel })) {
      if (chunk.type === 'text_delta') {
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
    const toolResultParts: string[] = []

    for (const toolCall of collectedToolCalls) {
      const perimResult = await checkPerimeter(toolCall)

      if ('_tag' in perimResult && perimResult._tag === 'HardBlock') {
        // Emit an error event to the caller but continue with other tools
        yield makeError('FORBIDDEN', perimResult.reason)
        toolResultParts.push(
          `Tool "${toolCall.name}" blocked: ${perimResult.reason}`,
        )
        continue
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
      toolResultParts.push(`${toolCall.name}(${JSON.stringify(toolCall.args)}) → ${JSON.stringify(result)}`)
    }

    // Append this round's exchange to messages for the next step.
    // We serialise tool calls and results as text to stay within the simple Message type.
    // Provider-specific formatting (Anthropic tool_use blocks, OpenAI tool role) is deferred
    // to M2 when we extend the message contract.
    const assistantContent = collectedToolCalls
      .map((tc) => `[tool_call id="${tc.id}" name="${tc.name}"] ${JSON.stringify(tc.args)}`)
      .join('\n')
    messages.push({ role: 'assistant', content: assistantContent })
    messages.push({ role: 'user', content: toolResultParts.join('\n') })
  }

  // Persist assistant turn summary
  await sessionMemory.append(ctx.sessionId, {
    role: 'assistant',
    content: '[streamed response]',
    timestamp: Date.now(),
  })

  yield { type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
}

function makeError(code: ErrorCode, message: string): StreamEvent & { type: 'error' } {
  return { type: 'error', code, message }
}
