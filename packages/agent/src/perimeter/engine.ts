import type { ConnectorMode, UserId } from '@anway/types'
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
  /**
   * Explicit per-tool allowlist, by exact tool name (e.g.
   * "my-notion-mcp.search_pages"). Native connectors (github, prometheus,
   * ...) have a fixed, code-reviewed tool set, so a connector-level
   * read/write scope is a safe default. MCP/CLI-backed connectors expose
   * whatever tools their real, arbitrary target server/binary happens to
   * have — most of those tool calls carry no generic `resource` arg at
   * all, so the read/write-scope check below would otherwise allow EVERY
   * discovered tool as soon as any read scope exists, regardless of
   * whether that specific tool was ever reviewed. When set, only tool
   * names in this list are allowed, full stop — anything discovered but
   * not in this list is denied by default, not fabricated as available.
   */
  readonly allowedTools?: string[]
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
  // Manifest-declared per-tool allowlist, by connectorId. Connector-level
  // (not intersected with user scope) — a hard boundary on which of a
  // dynamically-discovered tool set was ever reviewed, independent of which
  // resource patterns a given user is granted within it.
  private readonly allowedToolsByConnector: Map<string, Set<string>>
  // Harness-owned tools with bare names (no `<connector>.` prefix), e.g.
  // list_connectors, register_connector. Explicit allowlist — an unprefixed
  // tool NOT in this set is still hard-blocked. Write built-ins remain
  // subject to the gate (isWriteAction) downstream.
  private readonly builtins: Set<string>

  constructor(userPerimeter: UserPerimeter, manifests: ConnectorManifest[], builtinTools: string[] = []) {
    this.resolved = new Map()
    this.allowedToolsByConnector = new Map()
    this.builtins = new Set(builtinTools)
    const manifestMap = new Map(manifests.map((m) => [m.connectorId, m]))

    for (const manifest of manifests) {
      if (manifest.allowedTools) this.allowedToolsByConnector.set(manifest.connectorId, new Set(manifest.allowedTools))
    }

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

    const allowedTools = this.allowedToolsByConnector.get(connectorId)
    if (allowedTools && !allowedTools.has(toolCall.name)) return false

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
