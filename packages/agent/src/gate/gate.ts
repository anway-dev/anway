export interface GateEvent {
  id: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  connectorId: string
  tenantId: string
  userId: string
  sessionId: string
  confidence?: number
  createdAt: Date
}

export interface IGateSink {
  /** Stores pending gate event. Returns gateId. */
  push(event: GateEvent): Promise<string>
  /** Polls for user decision. Returns null if still pending. */
  poll(gateId: string): Promise<'approved' | 'rejected' | null>
  /** Called after decision recorded — for audit. */
  record(gateId: string, decision: 'approved' | 'rejected', decidedBy: string): Promise<void>
  /**
   * Atomically transitions status 'approved' -> 'consumed'. Single-use —
   * the caller that actually executes the write action must call this
   * before running it. Returns true only if this call performed the
   * transition (race-safe: two racing executors can't both consume the
   * same approval). Without this, an approved gate stays reusable for its
   * full validity window — a chat-approved write could be replayed
   * against a direct write route (or vice versa) using the same gateId.
   */
  consume(gateId: string): Promise<boolean>
}

export type GateDecision = { _tag: 'approved' } | { _tag: 'rejected'; reason: string } | { _tag: 'timeout' }

/** Write-action tool name patterns that require gate approval in V1. */
/** Read-only action prefixes — anything not in this list is treated as a write requiring gate approval. */
const READ_ACTION_PATTERNS = [
  /^get_/, /^list_/, /^fetch_/, /^read_/, /^search_/, /^query_/,
  /^describe_/, /^show_/, /^check_/, /^inspect_/, /^status_/,
  /^find_/, /^lookup_/, /^export_/,
  // Bare action names used by native connector tools (prometheus, alertmanager, loki, grafana)
  /^alerts$/, /^silences$/, /^targets$/, /^labels$/, /^dashboards$/, /^health$/, /^query$/,
]

/** Known safe built-in tool names that never require gating.
 * approve_gate: approval mechanism itself — cannot require its own gate.
 * register_connector and trigger_pipeline perform real writes (DB mutations,
 * deploy kickoffs) and must go through the L2 gate like all write actions.
 */
const BUILTIN_READ_TOOLS = new Set([
  'approve_gate',
])

export function isWriteAction(toolName: string): boolean {
  if (BUILTIN_READ_TOOLS.has(toolName)) return false
  // Extract action suffix: support both `connector.action` and `connector__action` formats
  let action = toolName
  if (toolName.includes('.')) action = toolName.split('.').pop() ?? toolName
  else if (toolName.includes('__')) action = toolName.split('__').pop() ?? toolName
  // READ_ACTION_PATTERNS are underscore-prefixed (native connectors' own
  // convention, e.g. get_pods) — MCP/CLI tool names are conventionally
  // kebab-case (get-resource-links), which none of those patterns match at
  // all. Confirmed live: this silently misclassified every read-shaped MCP
  // tool as a write action, denying it regardless of any per-tool allowlist
  // (scope.write is correctly empty, so the write branch always denies).
  // Normalize hyphens to underscores before testing, not the other way
  // round, since the patterns are the established native-connector contract.
  const normalized = action.replace(/-/g, '_')
  // Default-deny: anything that does NOT match a known read prefix is a write
  return !READ_ACTION_PATTERNS.some((p) => p.test(normalized))
}

export async function pollGate(
  sink: IGateSink,
  gateId: string,
  timeoutMs: number,
  intervalMs?: number,
  opts?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<GateDecision> {
  const resolvedInterval = opts?.intervalMs ?? intervalMs ?? 2000
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (opts?.signal?.aborted) return { _tag: 'timeout' }
    const decision = await sink.poll(gateId)
    if (decision === 'approved') return { _tag: 'approved' }
    if (decision === 'rejected') return { _tag: 'rejected', reason: 'User rejected' }
    await new Promise((r) => setTimeout(r, resolvedInterval))
  }
  return { _tag: 'timeout' }
}
