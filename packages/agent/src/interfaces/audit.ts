import type { SessionId, TenantId, UserId } from '@anvay/types'

export type AuditEventType =
  | 'query_received'
  | 'agent_spawned'
  | 'tool_call_allowed'
  | 'tool_call_blocked'
  | 'gate_decision'
  | 'write_action_confirmed'
  | 'write_action_executed'
  | 'session_end'
  | 'graph_context_failed'
  | 'incident_created'
  | 'incident_updated'
  | 'incident_resolved'
  | 'intent_parse_failed'
  | 'graph_miss'

export interface AuditEvent {
  readonly id: string
  readonly tenantId: TenantId
  readonly userId: UserId
  readonly sessionId: SessionId
  readonly eventType: AuditEventType
  readonly payload: Record<string, unknown>
  readonly createdAt: Date
}

export interface IAuditSink {
  append(event: AuditEvent): Promise<void>
}
