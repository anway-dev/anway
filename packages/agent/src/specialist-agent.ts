import type { Message, StreamEvent } from '@anvay/types'
import type { IAuditSink } from './interfaces/audit.js'
import type { IModelProvider, ToolCall, ToolDefinition } from './interfaces/provider.js'
import type { SessionContext } from './interfaces/memory.js'
import { createPerimeterMiddleware } from './middleware/perimeter.js'
import type { PerimeterCtx } from './middleware/perimeter.js'
import type { AgentPerimeter } from './perimeter/engine.js'
import type { ExecutableTool } from './orchestrator.js'
import { isWriteAction, pollGate } from './gate/gate.js'
import type { IGateSink } from './gate/gate.js'
import { connectorIdFromTool } from './tools/naming.js'
import type { IKnowledgeGraph, AgentContext } from './interfaces/knowledge-graph.js'

export interface SpecialistAgentConfig {
  name: string
  model: IModelProvider
  tools: ExecutableTool[]
  systemPrompt: string
  perimeter: AgentPerimeter
  auditSink: IAuditSink
  defaultModel?: string
  maxSteps?: number
  gateSink?: IGateSink
  gateTimeoutMs?: number
  knowledgeGraph?: IKnowledgeGraph
  contextEntityId?: string
}

export interface SpecialistAgent {
  readonly name: string
  run(input: string, ctx: SessionContext): AsyncGenerator<StreamEvent>
}

/**
 * Creates a specialist agent scoped to a single domain (SRE, Dev, PM, BA).
 * Hand-rolled agentic loop — same architecture as the orchestrator but without
 * intent classification. Model-agnostic via IModelProvider. Satisfies four of
 * six locked Mastra requirements (see orchestrator.ts JSDoc for details).
 */
export function createSpecialistAgent(config: SpecialistAgentConfig): SpecialistAgent {
  return {
    name: config.name,
    run: (input: string, ctx: SessionContext) => runSpecialist({
      ...config,
      ...(config.knowledgeGraph !== undefined ? { knowledgeGraph: config.knowledgeGraph } : {}),
      ...(config.contextEntityId !== undefined ? { contextEntityId: config.contextEntityId } : {}),
    }, input, ctx),
  }
}

function buildGroundedContextBlock(ctx: AgentContext): string {
  try {
    const primary = ctx.primaryEntity
    const related = ctx.relatedEntities ?? []
    const coords = ctx.connectorCoordinates ?? {}
    const parts: string[] = []
    if (primary?.name) parts.push(`Primary entity: ${primary.name} (${primary.type ?? 'unknown'})`)
    if (related.length > 0) parts.push(`Related entities: ${related.slice(0, 5).map(e => `${e.name} (${e.type})`).join(', ')}`)
    if (Object.keys(coords).length > 0) parts.push(`Connector coordinates: ${Object.entries(coords).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`)
    if (parts.length === 0) return ''
    return `<grounded_context>\n${parts.join('\n')}\n</grounded_context>\n[Note: Facts above were retrieved from the knowledge graph. If current connector data contradicts them, the live data takes precedence.]`
  } catch {
    return ''
  }
}

async function* runSpecialist(
  config: SpecialistAgentConfig,
  input: string,
  ctx: SessionContext,
): AsyncGenerator<StreamEvent> {
  const { model, tools, perimeter, auditSink } = config
  const mainModel = model.modelId
  const maxSteps = config.maxSteps ?? 10

  // Inject knowledge graph context if available (CLAUDE.md: graph is mandatory first step)
  let systemPrompt = config.systemPrompt
  if (config.knowledgeGraph && config.contextEntityId) {
    try {
      const agentCtx = await config.knowledgeGraph.resolveContext(config.contextEntityId, ctx.tenantId)
      const contextBlock = buildGroundedContextBlock(agentCtx)
      if (contextBlock) systemPrompt = contextBlock + '\n\n' + systemPrompt
    } catch (err) {
      yield { type: 'error' as const, code: 'GRAPH_CONTEXT_FAILED', message: err instanceof Error ? err.message : String(err) }
      return
    }
  }

  const perimeterCtx: PerimeterCtx = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
  }
  const checkPerimeter = createPerimeterMiddleware(perimeter, auditSink, perimeterCtx)

  await auditSink.append({
    id: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    eventType: 'agent_spawned',
    payload: { agentName: config.name, input },
    createdAt: new Date(),
  })

  const toolDefs: ToolDefinition[] = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input },
  ]

  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (let step = 0; step < maxSteps; step++) {
    const collectedToolCalls: ToolCall[] = []
    let hasToolCalls = false

    for await (const chunk of model.stream(messages, toolDefs, { model: mainModel })) {
      if (chunk.type === 'text_delta') {
        yield chunk
      } else if (chunk.type === 'tool_call') {
        hasToolCalls = true
        collectedToolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args: chunk.args })
        yield chunk
      } else if (chunk.type === 'done') {
        totalInputTokens += chunk.inputTokens
        totalOutputTokens += chunk.outputTokens
      } else if (chunk.type === 'error') {
        yield chunk
        return
      }
    }

    if (!hasToolCalls) break

    const toolResults = new Map<string, string>()

    for (const toolCall of collectedToolCalls) {
      const perimResult = await checkPerimeter(toolCall)

      if ('_tag' in perimResult && perimResult._tag === 'HardBlock') {
        yield { type: 'error', code: 'FORBIDDEN', message: perimResult.reason }
        toolResults.set(toolCall.id, `Tool "${toolCall.name}" blocked: ${perimResult.reason}`)
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
        yield { type: 'gate_required', gateId, toolCallId: toolCall.id, toolName: toolCall.name, args: toolCall.args }
        const decision = await pollGate(config.gateSink, gateId, config.gateTimeoutMs ?? 30_000)
        if (decision._tag !== 'approved') {
          await config.auditSink.append({
            id: crypto.randomUUID(),
            tenantId: ctx.tenantId, userId: ctx.userId, sessionId: ctx.sessionId,
            eventType: 'tool_call_blocked',
            payload: { gateId, toolName: toolCall.name, decision: decision._tag },
            createdAt: new Date(),
          })
          const blockMsg = `Write action "${toolCall.name}" ${decision._tag === 'rejected' ? 'rejected by user' : 'timed out'}`
          toolResults.set(toolCall.id, blockMsg)
          yield { type: 'tool_result', toolCallId: toolCall.id, result: blockMsg }
          continue
        }
      }

      const execTool = tools.find((t) => t.name === toolCall.name)
      let result: unknown

      if (execTool) {
        try {
          result = await execTool.run(toolCall.args)
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : 'unknown'}`
        }
      } else {
        result = `Tool "${toolCall.name}" not found`
      }

      yield { type: 'tool_result', toolCallId: toolCall.id, result }
      toolResults.set(toolCall.id, `${toolCall.name} → ${JSON.stringify(result)}`)
    }

    messages.push(model.formatToolCall(collectedToolCalls))
    for (const tc of collectedToolCalls) {
      messages.push(model.formatToolResult(tc.id, toolResults.get(tc.id) ?? '(no result)'))
    }
  }

  yield { type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
}
