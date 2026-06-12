import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

interface AuditEvent {
  id: string
  timestamp: string
  user: string
  authRole: string
  inferredRole: string
  query: string
  agents: string[]
  outcome: 'root_cause_found' | 'answer_provided' | 'status_provided' | 'analysis_provided' | 'pr_created' | 'gate_required' | 'auto_approved' | 'access_denied' | 'rollback_initiated' | 'blocked' | 'action_executed' | 'action_failed'
  detail: string
  durationMs: number
}

interface AuditRow {
  id: string
  event_type: string
  payload: Record<string, unknown>
  created_at: Date
  user_id: string | null
}

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }

    const limitClause = Math.min(Number((request.query as Record<string, string>)['limit']) || 50, 200)
    const offsetClause = Math.max(Number((request.query as Record<string, string>)['offset']) || 0, 0)
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<AuditRow[]>`
        SELECT id, event_type, payload, created_at, user_id
        FROM audit_events ORDER BY created_at DESC LIMIT ${limitClause} OFFSET ${offsetClause}
      `
    ).catch(() => [] as AuditRow[])

    return rows.map(r => {
      const p = (r.payload ?? {}) as Record<string, unknown>
      return {
        id: r.id,
        timestamp: r.created_at.toISOString(),
        user: r.user_id?.slice(0, 8) ?? 'system',
        authRole: (p['authRole'] as string) ?? 'system',
        inferredRole: (p['inferredRole'] as string) ?? (p['authRole'] as string) ?? 'system',
        query: (p['query'] as string) ?? r.event_type,
        agents: ((p['agents'] as string[]) ?? []),
        outcome: mapOutcome(r.event_type, p),
        detail: (p['detail'] as string) ?? (p['message'] as string) ?? '',
        durationMs: (p['durationMs'] as number) ?? 0,
      } as AuditEvent
    })
  })
}

function mapOutcome(eventType: string, payload: Record<string, unknown>): AuditEvent['outcome'] {
  const outcomeMap: Record<string, AuditEvent['outcome']> = {
    'query_completed': 'root_cause_found',
    'gate_required': 'gate_required',
    'gate_approved': 'auto_approved',
    'access_denied': 'access_denied',
    'action_executed': 'action_executed',
    'action_failed': 'action_failed',
    'pr_created': 'pr_created',
    'incident_created': 'root_cause_found',
    'incident_resolved': 'status_provided',
  }
  return outcomeMap[eventType] ?? ((payload['outcome'] as AuditEvent['outcome']) ?? 'answer_provided')
}
