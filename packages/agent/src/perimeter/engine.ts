import type { ConnectorMode, UserId } from '@anvay/types'
import type { ToolCall } from '../interfaces/provider.js'

export interface ConnectorScope {
  readonly connectorId: string
  readonly read: string[]
  readonly write: string[]
}

export interface UserPerimeter {
  readonly userId: UserId
  readonly connectors: ConnectorScope[]
}

export interface ConnectorManifest {
  readonly connectorId: string
  readonly mode: ConnectorMode
  readonly capabilities: {
    readonly read: string[]
    readonly write: string[]
  }
}

export interface HardBlock {
  readonly _tag: 'HardBlock'
  readonly reason: string
  readonly toolCall: ToolCall
  readonly rule: string
}

// Returns true if resourcePattern (possibly with wildcard "*" or "prefix/*") matches resource.
function matchesResource(pattern: string, resource: string): boolean {
  if (pattern === '*') return true
  if (pattern === resource) return true
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return resource === prefix || resource.startsWith(`${prefix}/`)
  }
  return false
}

function matchesAny(patterns: string[], resource: string): boolean {
  return patterns.some((p) => matchesResource(p, resource))
}

interface ResolvedScope {
  read: string[]
  write: string[]
}

// Intersection of user scope and connector manifest capabilities for one connector.
function intersectScope(userScope: ConnectorScope, manifest: ConnectorManifest): ResolvedScope {
  const read = userScope.read.filter((r) =>
    manifest.capabilities.read.some((m) => matchesResource(m, r) || matchesResource(r, m) || r === m || m === '*'),
  )
  const write = userScope.write.filter((r) =>
    manifest.capabilities.write.some((m) => matchesResource(m, r) || matchesResource(r, m) || r === m || m === '*'),
  )
  return { read, write }
}

// Write action suffixes — if a tool name contains any of these, it is treated as a write action.
const WRITE_SUFFIXES = [
  'create', 'update', 'delete', 'write', 'push', 'deploy',
  'restart', 'scale', 'patch', 'merge', 'close', 'post', 'put',
]

function isWriteAction(toolName: string): boolean {
  const action = toolName.includes('.') ? toolName.split('.').slice(1).join('.') : toolName
  return WRITE_SUFFIXES.some((s) => action.toLowerCase().includes(s))
}

function connectorIdFromTool(toolName: string): string {
  const dot = toolName.indexOf('.')
  return dot === -1 ? toolName : toolName.slice(0, dot)
}

export class AgentPerimeter {
  // Map from connectorId → resolved (user ∩ manifest) scopes
  private readonly resolved: Map<string, ResolvedScope>

  constructor(userPerimeter: UserPerimeter, manifests: ConnectorManifest[]) {
    this.resolved = new Map()
    const manifestMap = new Map(manifests.map((m) => [m.connectorId, m]))

    for (const scope of userPerimeter.connectors) {
      const manifest = manifestMap.get(scope.connectorId)
      if (!manifest) continue
      this.resolved.set(scope.connectorId, intersectScope(scope, manifest))
    }
  }

  /** Deterministic rule evaluation — no LLM involved. */
  allows(toolCall: ToolCall): boolean {
    const connectorId = connectorIdFromTool(toolCall.name)
    const scope = this.resolved.get(connectorId)
    if (!scope) return false

    const resource = typeof toolCall.args['resource'] === 'string' ? toolCall.args['resource'] : '*'

    if (isWriteAction(toolCall.name)) {
      if (scope.write.length === 0) return false
      return matchesAny(scope.write, resource)
    }

    if (scope.read.length === 0) return false
    return matchesAny(scope.read, resource)
  }

  /** Returns a typed HardBlock. Caller is responsible for audit-logging it. */
  hardBlock(call: ToolCall, reason: string): HardBlock {
    return {
      _tag: 'HardBlock',
      reason,
      toolCall: call,
      rule: `perimeter:${connectorIdFromTool(call.name)}`,
    }
  }

  static resolveCapabilities(
    userPerimeter: UserPerimeter,
    manifests: ConnectorManifest[],
  ): AgentPerimeter {
    return new AgentPerimeter(userPerimeter, manifests)
  }
}
