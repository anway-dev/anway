import { describe, expect, it, vi } from 'vitest'
import { SessionId, TenantId, UserId } from '@anway/types'
import type { IAuditSink } from '../interfaces/audit.js'
import type { ToolCall } from '../interfaces/provider.js'
import { AgentPerimeter } from '../perimeter/engine.js'
import type { ConnectorManifest, UserPerimeter } from '../perimeter/engine.js'
import { createPerimeterMiddleware } from './perimeter.js'

function makeCall(name: string): ToolCall {
  return { id: 'tc-1', name, args: {} }
}

function makeSink(): { sink: IAuditSink; events: ReturnType<typeof vi.fn> } {
  const append = vi.fn().mockResolvedValue(undefined)
  return { sink: { append }, events: append }
}

const manifests: ConnectorManifest[] = [
  { connectorId: 'github', mode: 'read-write', capabilities: { read: ['*'], write: ['org/repo-a'] } },
]

const userPerimeter: UserPerimeter = {
  userId: UserId('user-1'),
  connectors: [{ connectorId: 'github', read: ['*'], write: ['org/repo-a'] }],
}

const ctx = {
  tenantId: TenantId('tenant-1'),
  userId: UserId('user-1'),
  sessionId: SessionId('session-1'),
}

describe('createPerimeterMiddleware', () => {
  it('allows permitted call and appends tool_call_allowed to audit sink', async () => {
    const perimeter = new AgentPerimeter(userPerimeter, manifests)
    const { sink, events } = makeSink()
    const middleware = createPerimeterMiddleware(perimeter, sink, ctx)

    const call = makeCall('github.list_prs')
    const result = await middleware(call)

    expect(result).toBe(call)
    expect(events).toHaveBeenCalledOnce()
    const event = events.mock.calls[0]?.[0]
    expect(event.eventType).toBe('tool_call_allowed')
    expect(event.tenantId).toBe(ctx.tenantId)
    expect(event.userId).toBe(ctx.userId)
    expect(event.sessionId).toBe(ctx.sessionId)
  })

  it('blocks unpermitted call and appends tool_call_blocked to audit sink', async () => {
    const perimeter = new AgentPerimeter(userPerimeter, manifests)
    const { sink, events } = makeSink()
    const middleware = createPerimeterMiddleware(perimeter, sink, ctx)

    const call = makeCall('linear.list_issues')
    const result = await middleware(call)

    expect((result as { _tag: string })._tag).toBe('HardBlock')
    expect(events).toHaveBeenCalledOnce()
    const event = events.mock.calls[0]?.[0]
    expect(event.eventType).toBe('tool_call_blocked')
  })

  it('always calls audit sink — no path skips the log', async () => {
    const perimeter = new AgentPerimeter(userPerimeter, manifests)
    const { sink, events } = makeSink()
    const middleware = createPerimeterMiddleware(perimeter, sink, ctx)

    // One allowed, one blocked
    await middleware(makeCall('github.list_prs'))
    await middleware(makeCall('argocd.deploy'))

    expect(events).toHaveBeenCalledTimes(2)
  })
})
