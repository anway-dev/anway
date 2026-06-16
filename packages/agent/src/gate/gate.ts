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
}

export type GateDecision = { _tag: 'approved' } | { _tag: 'rejected'; reason: string } | { _tag: 'timeout' }

/** Write-action tool name patterns that require gate approval in V1. */
/** Read-only action prefixes — anything not in this list is treated as a write requiring gate approval. */
const READ_ACTION_PATTERNS = [
  /^get_/, /^list_/, /^fetch_/, /^read_/, /^search_/, /^query_/,
  /^describe_/, /^show_/, /^check_/, /^inspect_/, /^status_/,
  /^find_/, /^lookup_/, /^export_/,
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
  // Test action suffix only — tools are named `<connector>.<action>` (e.g. `github.create_pr`)
  const action = toolName.split('.').pop() ?? toolName
  // Default-deny: anything that does NOT match a known read prefix is a write
  return !READ_ACTION_PATTERNS.some((p) => p.test(action))
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
