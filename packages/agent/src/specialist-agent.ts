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
    run: (input: string, ctx: SessionContext) => runSpecialist(config, input, ctx),
  }
}

async function* runSpecialist(
  config: SpecialistAgentConfig,
  input: string,
  ctx: SessionContext,
): AsyncGenerator<StreamEvent> {
  const { model, tools, perimeter, auditSink } = config
  const mainModel = config.defaultModel ?? 'claude-sonnet-4-6'
  const maxSteps = config.maxSteps ?? 10

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
    { role: 'system', content: config.systemPrompt },
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

    const toolResultParts: string[] = []

    for (const toolCall of collectedToolCalls) {
      const perimResult = await checkPerimeter(toolCall)

      if ('_tag' in perimResult && perimResult._tag === 'HardBlock') {
        yield { type: 'error', code: 'FORBIDDEN', message: perimResult.reason }
        toolResultParts.push(`Tool "${toolCall.name}" blocked: ${perimResult.reason}`)
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
          connectorId: toolCall.name.split('.')[0] ?? toolCall.name,
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
          toolResultParts.push(blockMsg)
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
      toolResultParts.push(`${toolCall.name} → ${JSON.stringify(result)}`)
    }

    const assistantContent = collectedToolCalls
      .map((tc) => `[tool_call id="${tc.id}" name="${tc.name}"] ${JSON.stringify(tc.args)}`)
      .join('\n')
    messages.push({ role: 'assistant', content: assistantContent })
    messages.push({ role: 'user', content: toolResultParts.join('\n') })
  }

  yield { type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
}
