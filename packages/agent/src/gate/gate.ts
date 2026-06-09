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
const WRITE_ACTION_PATTERNS = [
  /^notify_/, /^create_/, /^delete_/, /^update_/, /^deploy/, /^restart/,
  /^scale/, /^rollback/, /^merge/, /^comment/, /^run_runbook/,
]

export function isWriteAction(toolName: string): boolean {
  // Test action suffix only — tools are named `<connector>.<action>` (e.g. `github.create_pr`)
  const action = toolName.split('.').pop() ?? toolName
  return WRITE_ACTION_PATTERNS.some((p) => p.test(action))
}

export async function pollGate(
  sink: IGateSink,
  gateId: string,
  timeoutMs: number,
  intervalMs?: number,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<GateDecision> {
  const resolvedInterval = opts?.intervalMs ?? intervalMs ?? 500
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const decision = await sink.poll(gateId)
    if (decision === 'approved') return { _tag: 'approved' }
    if (decision === 'rejected') return { _tag: 'rejected', reason: 'User rejected' }
    await new Promise((r) => setTimeout(r, resolvedInterval))
  }
  return { _tag: 'timeout' }
}
