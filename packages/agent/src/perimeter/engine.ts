import type { ConnectorMode, UserId } from '@anvay/types'
import type { ToolCall } from '../interfaces/provider.js'
import { connectorIdFromTool } from '../tools/naming.js'
import { isWriteAction } from '../gate/gate.js'

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

function intersectResourceLists(userList: string[], manifestList: string[]): string[] {
  // Manifest permits everything — user scope is the ceiling
  if (manifestList.includes('*')) return userList
  // User wants everything — manifest scope is the ceiling
  if (userList.includes('*')) return manifestList
  // Both specific — keep user resources that the manifest explicitly covers
  return userList.filter((r) => manifestList.some((m) => matchesResource(m, r)))
}

// Intersection of user scope and connector manifest capabilities for one connector.
function intersectScope(userScope: ConnectorScope, manifest: ConnectorManifest): ResolvedScope {
  return {
    read: intersectResourceLists(userScope.read, manifest.capabilities.read),
    write: intersectResourceLists(userScope.write, manifest.capabilities.write),
  }
}

export class AgentPerimeter {
  // Map from connectorId → resolved (user ∩ manifest) scopes
  private readonly resolved: Map<string, ResolvedScope>
  // Harness-owned tools with bare names (no `<connector>.` prefix), e.g.
  // list_connectors, register_connector. Explicit allowlist — an unprefixed
  // tool NOT in this set is still hard-blocked. Write built-ins remain
  // subject to the gate (isWriteAction) downstream.
  private readonly builtins: Set<string>

  constructor(userPerimeter: UserPerimeter, manifests: ConnectorManifest[], builtinTools: string[] = []) {
    this.resolved = new Map()
    this.builtins = new Set(builtinTools)
    const manifestMap = new Map(manifests.map((m) => [m.connectorId, m]))

    for (const scope of userPerimeter.connectors) {
      const manifest = manifestMap.get(scope.connectorId)
      if (!manifest) continue
      this.resolved.set(scope.connectorId, intersectScope(scope, manifest))
    }
  }

  /** Deterministic rule evaluation — no LLM involved. */
  allows(toolCall: ToolCall): boolean {
    // Bare-named harness tools: allowed only via the explicit builtin allowlist.
    // A tool with neither `.` nor `__` is a bare name; `connector__action` format
    // falls through to the connector-scope check below (LLM-API-safe naming).
    if (!toolCall.name.includes('.') && !toolCall.name.includes('__')) {
      return this.builtins.has(toolCall.name)
    }

    const connectorId = connectorIdFromTool(toolCall.name)
    const scope = this.resolved.get(connectorId)
    if (!scope) return false

    const resource = typeof toolCall.args['resource'] === 'string' ? toolCall.args['resource'] : null

    if (resource === null) {
      if (isWriteAction(toolCall.name)) return scope.write.length > 0 && scope.write.includes('*')
      return scope.read.length > 0  // Any read scope = allowed for non-resource tools
    }

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
    builtinTools: string[] = [],
  ): AgentPerimeter {
    return new AgentPerimeter(userPerimeter, manifests, builtinTools)
  }
}
