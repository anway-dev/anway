import type { SessionId, TenantId, UserId } from '@anvay/types'
import type { IAuditSink } from '../interfaces/audit.js'
import type { ToolCall } from '../interfaces/provider.js'
import type { HardBlock } from '../perimeter/engine.js'
import { AgentPerimeter } from '../perimeter/engine.js'

export interface PerimeterCtx {
  readonly tenantId: TenantId
  readonly userId: UserId
  readonly sessionId: SessionId
}

/**
 * Returns a middleware function that enforces the perimeter on every tool call.
 * Both allowed and blocked calls are audit-logged — no code path skips the log.
 */
export function createPerimeterMiddleware(
  perimeter: AgentPerimeter,
  auditSink: IAuditSink,
  ctx: PerimeterCtx,
): (call: ToolCall) => Promise<ToolCall | HardBlock> {
  return async (call: ToolCall): Promise<ToolCall | HardBlock> => {
    if (perimeter.allows(call)) {
      await auditSink.append({
        id: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        eventType: 'tool_call_allowed',
        payload: { toolName: call.name, args: call.args },
        createdAt: new Date(),
      })
      return call
    }

    const block = perimeter.hardBlock(call, `tool call '${call.name}' is outside the resolved capability envelope`)
    await auditSink.append({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      eventType: 'tool_call_blocked',
      payload: { toolName: call.name, args: call.args, reason: block.reason, rule: block.rule },
      createdAt: new Date(),
    })
    return block
  }
}
