import type { FastifyInstance } from 'fastify'

interface AuditEvent {
  id: string
  timestamp: string
  user: string
  authRole: string
  inferredRole: string
  query: string
  agents: string[]
  outcome: 'root_cause_found' | 'gate_required' | 'auto_approved' | 'access_denied' | 'action_executed' | 'action_failed' | 'escalated' | 'blocked' | 'handed_off'
  detail: string
  durationMs: number
}

const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  { id: 'evt-001', timestamp: '2026-05-31 14:47:02', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Alert: payments-api error rate 8%', agents: ['datadog-agent', 'loki-agent', 'k8s-agent', 'github-agent'], outcome: 'root_cause_found', detail: 'Root cause identified: payments-service v2.3.0 deployed 14 min ago introduced null pointer in QuickCheckoutHandler.java:89. Confidence: 0.94.', durationMs: 3240 },
  { id: 'evt-002', timestamp: '2026-05-31 14:48:15', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Rollback to v2.2.9', agents: ['argocd-agent'], outcome: 'gate_required', detail: 'Rollback action requires L2 approval gate. Waiting for tech-lead sign-off. Gate ID: gate-prod-rollback-881.', durationMs: 820 },
  { id: 'evt-003', timestamp: '2026-05-31 14:49:30', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Rollback to v2.2.9', agents: ['argocd-agent'], outcome: 'auto_approved', detail: 'Gate auto-approved. Tech Lead (bob) approved rollback. Proceeding with ArgoCD rollback to v2.2.9.', durationMs: 45000 },
  { id: 'evt-004', timestamp: '2026-05-31 14:50:12', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Rollback to v2.2.9', agents: ['argocd-agent', 'k8s-agent'], outcome: 'action_executed', detail: 'Rollback executed. ArgoCD synced payments-api to v2.2.9. 3/3 pods healthy.', durationMs: 12800 },
  { id: 'evt-005', timestamp: '2026-05-31 14:52:00', user: 'alice', authRole: 'dev', inferredRole: 'sre', query: 'Is error rate back to baseline?', agents: ['datadog-agent'], outcome: 'root_cause_found', detail: 'Error rate dropped to 1.2%. 3.5 min to recovery. Payments-api healthy.', durationMs: 2100 },
  { id: 'evt-006', timestamp: '2026-05-31 14:32:00', user: 'bob', authRole: 'tech_lead', inferredRole: 'sre', query: 'Deploy payments-api v2.3.0 to prod', agents: ['github-agent', 'argocd-agent'], outcome: 'action_executed', detail: 'v2.3.0 deployed to prod. 5 pods rolled. Commit a4f21bc.', durationMs: 36400 },
  { id: 'evt-007', timestamp: '2026-05-31 14:00:00', user: 'charlie', authRole: 'pm', inferredRole: 'pm', query: 'Status of Reduce Checkout Friction feature', agents: ['linear-agent', 'github-agent', 'datadog-agent'], outcome: 'root_cause_found', detail: 'Feature on track. PRD approved, tech spec in review, CI passing. One issue: TC-004 edge case still failing.', durationMs: 5800 },
  { id: 'evt-008', timestamp: '2026-05-31 13:45:00', user: 'dave', authRole: 'sre', inferredRole: 'sre', query: 'Why is auth-service latency high?', agents: ['datadog-agent', 'loki-agent', 'k8s-agent'], outcome: 'root_cause_found', detail: 'Latency spike due to Redis connection pool exhaustion after deploys. Added connection pooling fix in PR #442.', durationMs: 8900 },
  { id: 'evt-009', timestamp: '2026-05-31 11:20:00', user: 'alice', authRole: 'dev', inferredRole: 'dev', query: 'Try to restart prod payments-api pods', agents: ['k8s-agent'], outcome: 'access_denied', detail: 'Action blocked. Alice (dev) does not have write permission on prod namespace payments-api. Minimum role required: tech_lead.', durationMs: 340 },
  { id: 'evt-010', timestamp: '2026-05-30 09:15:00', user: 'eve', authRole: 'ba', inferredRole: 'ba', query: 'Compare payments conversion rates by region', agents: ['datadog-agent', 'graph-builder'], outcome: 'root_cause_found', detail: 'APAC: 34.2%, EMEA: 31.8%, US: 29.1%. US underperforming by 5 pts due to higher 3DS failure rate.', durationMs: 6100 },
  { id: 'evt-011', timestamp: '2026-05-29 16:00:00', user: 'bob', authRole: 'tech_lead', inferredRole: 'sre', query: 'Why did CI fail on feature/quick-checkout-v2?', agents: ['github-agent', 'sentry-agent'], outcome: 'root_cause_found', detail: 'CI failing on TC-004 (HighValue3DSBypass). NullPointerException in test mock setup — mock doesn\'t return riskScore for amounts > 500.', durationMs: 4200 },
  { id: 'evt-012', timestamp: '2026-05-29 15:30:00', user: 'charlie', authRole: 'pm', inferredRole: 'pm', query: 'What is blocking feature/quick-checkout-v2 from shipping?', agents: ['github-agent', 'linear-agent', 'datadog-agent'], outcome: 'root_cause_found', detail: '2 blockers: TC-004 failing (null pointer in test mock), and spec gap on 3DS bypass boundary. Estimated unblock: 3 days.', durationMs: 7300 },
  { id: 'evt-013', timestamp: '2026-05-29 14:00:00', user: 'dave', authRole: 'sre', inferredRole: 'sre', query: 'triage view — last 24h', agents: ['datadog-agent', 'loki-agent', 'k8s-agent', 'github-agent', 'pagerduty-agent'], outcome: 'root_cause_found', detail: '7 alerts, 2 critical. 1 ongoing (payments-api latency). 1 auto-resolved (memory spike on checkout-v2). 300 error budget remaining.', durationMs: 8400 },
  { id: 'evt-014', timestamp: '2026-05-29 10:10:00', user: 'alice', authRole: 'dev', inferredRole: 'dev', query: 'Create PR to fix NullPointerException in QuickCheckoutHandler', agents: ['github-agent', 'review-agent'], outcome: 'gate_required', detail: 'PR created. Review assigned: bob (tech_lead). Blocking TC-004 from passing.', durationMs: 1500 },
  { id: 'evt-015', timestamp: '2026-05-28 12:00:00', user: 'bob', authRole: 'tech_lead', inferredRole: 'sre', query: 'Review PR #443 — fix NullPointerException', agents: ['review-agent', 'github-agent'], outcome: 'auto_approved', detail: 'Auto-approved. 3/3 CI checks passing. 1 reviewer approved. PR merged to main.', durationMs: 2200 },
]

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', {
    preHandler: [app.authenticate],
  }, async () => {
    return MOCK_AUDIT_EVENTS
  })
}
