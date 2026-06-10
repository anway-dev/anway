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

// Seed events for demo when audit_events table is empty
const DEMO_EVENTS: AuditEvent[] = [
  { id: 'evt-001', timestamp: '14:47:02', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Alert: payments-api error rate 8%', agents: ['datadog-agent', 'loki-agent', 'k8s-agent', 'github-agent'], outcome: 'root_cause_found', detail: 'Root cause identified: payments-service v2.3.0 deployed 14 min ago introduced null pointer.', durationMs: 3240 },
  { id: 'evt-002', timestamp: '14:48:15', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Rollback to v2.2.9', agents: ['argocd-agent'], outcome: 'gate_required', detail: 'Rollback action requires L2 approval gate. Gate ID: gate-prod-rollback-881.', durationMs: 820 },
  { id: 'evt-003', timestamp: '14:49:30', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Rollback to v2.2.9', agents: ['argocd-agent'], outcome: 'auto_approved', detail: 'Gate auto-approved. Tech Lead (bob) approved rollback.', durationMs: 45000 },
  { id: 'evt-004', timestamp: '14:50:12', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Rollback to v2.2.9', agents: ['argocd-agent', 'k8s-agent'], outcome: 'action_executed', detail: 'Rollback executed. ArgoCD synced payments-api to v2.2.9.', durationMs: 12800 },
  { id: 'evt-005', timestamp: '14:52:00', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Is error rate back to baseline?', agents: ['datadog-agent'], outcome: 'root_cause_found', detail: 'Error rate dropped to 1.2%. Payments-api healthy.', durationMs: 2100 },
  { id: 'evt-006', timestamp: '14:32:00', user: 'bob', authRole: 'tech_lead', inferredRole: 'sre', query: 'Deploy payments-api v2.3.0 to prod', agents: ['github-agent', 'argocd-agent'], outcome: 'action_executed', detail: 'v2.3.0 deployed to prod. Commit a4f21bc.', durationMs: 36400 },
  { id: 'evt-007', timestamp: '14:00:00', user: 'charlie', authRole: 'pm', inferredRole: 'pm', query: 'Status of Reduce Checkout Friction feature', agents: ['linear-agent', 'github-agent', 'datadog-agent'], outcome: 'root_cause_found', detail: 'Feature on track. TC-004 edge case still failing.', durationMs: 5800 },
  { id: 'evt-008', timestamp: '13:45:00', user: 'dave', authRole: 'sre', inferredRole: 'sre', query: 'Why is auth-service latency high?', agents: ['datadog-agent', 'loki-agent', 'k8s-agent'], outcome: 'root_cause_found', detail: 'Latency spike due to Redis connection pool exhaustion.', durationMs: 8900 },
  { id: 'evt-009', timestamp: '11:20:00', user: 'alice', authRole: 'dev', inferredRole: 'dev', query: 'Try to restart prod payments-api pods', agents: ['k8s-agent'], outcome: 'access_denied', detail: 'Alice (dev) does not have write permission on prod namespace.', durationMs: 340 },
  { id: 'evt-010', timestamp: '09:15:00', user: 'eve', authRole: 'ba', inferredRole: 'ba', query: 'Compare payments conversion rates by region', agents: ['datadog-agent', 'graph-builder'], outcome: 'root_cause_found', detail: 'APAC: 34.2%, EMEA: 31.8%, US: 29.1%.', durationMs: 6100 },
  { id: 'evt-011', timestamp: '16:00:00', user: 'bob', authRole: 'tech_lead', inferredRole: 'sre', query: 'Why did CI fail on feature/quick-checkout-v2?', agents: ['github-agent', 'sentry-agent'], outcome: 'root_cause_found', detail: 'CI failing on TC-004 — NullPointerException in test mock.', durationMs: 4200 },
  { id: 'evt-012', timestamp: '15:30:00', user: 'charlie', authRole: 'pm', inferredRole: 'pm', query: 'What blocks feature/quick-checkout-v2?', agents: ['github-agent', 'linear-agent', 'datadog-agent'], outcome: 'root_cause_found', detail: '2 blockers: TC-004 failing and spec gap on 3DS bypass boundary.', durationMs: 7300 },
  { id: 'evt-013', timestamp: '14:00:00', user: 'dave', authRole: 'sre', inferredRole: 'sre', query: 'triage view — last 24h', agents: ['datadog-agent', 'loki-agent', 'k8s-agent', 'github-agent', 'pagerduty-agent'], outcome: 'root_cause_found', detail: '7 alerts, 2 critical. 300 error budget remaining.', durationMs: 8400 },
  { id: 'evt-014', timestamp: '10:10:00', user: 'alice', authRole: 'dev', inferredRole: 'dev', query: 'Create PR to fix NullPointerException in QuickCheckoutHandler', agents: ['github-agent', 'review-agent'], outcome: 'gate_required', detail: 'PR created. Review assigned: bob.', durationMs: 1500 },
  { id: 'evt-015', timestamp: '12:00:00', user: 'bob', authRole: 'tech_lead', inferredRole: 'sre', query: 'Review PR #443 — fix NullPointerException', agents: ['review-agent', 'github-agent'], outcome: 'auto_approved', detail: 'Auto-approved. 3/3 CI checks passing. PR merged.', durationMs: 2200 },
]

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }

    // Query audit_events from DB — RLS filters by tenant (limit param, max 200)
    const limitClause = Math.min(Number((request.query as Record<string, string>)['limit']) || 50, 200)
    const offsetClause = Math.max(Number((request.query as Record<string, string>)['offset']) || 0, 0)
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<AuditRow[]>`
        SELECT id, event_type, payload, created_at, user_id
        FROM audit_events ORDER BY created_at DESC LIMIT ${limitClause} OFFSET ${offsetClause}
      `
    ).catch(() => [] as AuditRow[])

    if (rows.length === 0) return DEMO_EVENTS

    // Map DB records to frontend AuditEvent format
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
