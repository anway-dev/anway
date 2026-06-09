import type { FastifyInstance } from 'fastify'

// Mock LiveAlert data — same shape as web/lib/mock.ts
// Swap to DB query when alerts table exists
interface LiveAlert {
  id: string
  kind: 'alert' | 'ticket' | 'metric' | 'customer' | 'ci' | 'error'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  source: string
  sourceIcon: string
  sourceColor: string
  service: string
  timestamp: string
  triageStatus: 'auto_triaged' | 'triaging' | 'pending' | 'escalated'
  triageSummary?: string
  confidence?: number
  gateId?: string
  gateStatus?: 'pending_approval' | 'auto_approved'
  orchestratorQuery: string
  branch?: string
  commitSha?: string
  runUrl?: string
  errorCount?: number
  firstSeen?: string
}

const MOCK_ALERTS: LiveAlert[] = [
  {
    id: 'alrt-001', kind: 'alert', severity: 'critical',
    title: 'payments-api error rate 8.4% (threshold: 1%)',
    source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed',
    service: 'payments-api', timestamp: '2 min ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'Root cause: payments-service v2.3.0 deployed 14 min ago. NullPointerException in QuickCheckoutHandler.java:89 — riskScore null when amount > 500. 3/5 pods in CrashLoopBackOff.',
    confidence: 0.94, gateId: 'gate-prod-rollback-881', gateStatus: 'pending_approval',
    orchestratorQuery: 'Why is payments-api error rate at 8.4%? Alert triggered 2 min ago.',
  },
  {
    id: 'alrt-002', kind: 'alert', severity: 'critical',
    title: '3 pods CrashLoopBackOff — payments namespace',
    source: 'Amazon EKS', sourceIcon: 'EK', sourceColor: '#f59e0b',
    service: 'payments-api', timestamp: '3 min ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'All 3 pods on v2.3.0. Restart count: 5. Same root cause as Datadog error alert — null pointer at startup in QuickCheckoutHandler.',
    confidence: 0.91, gateId: 'gate-k8s-scale-992', gateStatus: 'auto_approved',
    orchestratorQuery: 'Why are 3 payments-api pods in CrashLoopBackOff?',
  },
  {
    id: 'alrt-003', kind: 'alert', severity: 'high',
    title: 'auth-service p99 latency spike — 1,240ms (baseline: 180ms)',
    source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed',
    service: 'auth-service', timestamp: '8 min ago',
    triageStatus: 'triaging',
    orchestratorQuery: 'Why did auth-service p99 latency spike to 1240ms? Baseline is 180ms.',
  },
  {
    id: 'alrt-004', kind: 'alert', severity: 'high',
    title: 'OOMKilled — 3 payments-api pods in last 30 min',
    source: 'Amazon EKS', sourceIcon: 'EK', sourceColor: '#f59e0b',
    service: 'payments-api', timestamp: '18 min ago',
    triageStatus: 'pending',
    orchestratorQuery: 'Why are payments-api pods getting OOMKilled?',
  },
  {
    id: 'tkt-001', kind: 'ticket', severity: 'high',
    title: 'LIN-2289 · 3DS bypass not triggering for $30–$50 range',
    source: 'Linear', sourceIcon: 'LN', sourceColor: '#5e6ad2',
    service: 'payments-api', timestamp: '1 hour ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'Linked to TC-004 test failure. Risk threshold spec gap: spec says skip 3DS for < $50 but doesn\'t define boundary case.',
    confidence: 0.88,
    orchestratorQuery: 'Why is LIN-2289 blocked? 3DS bypass not working for $30–$50 range.',
  },
  {
    id: 'tkt-002', kind: 'ticket', severity: 'high',
    title: 'LIN-2291 · Mobile checkout drop-off increasing',
    source: 'Linear', sourceIcon: 'LN', sourceColor: '#5e6ad2',
    service: 'checkout-v2', timestamp: '2 hours ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'Datadog RUM: 40% drop at payment entry on mobile. Correlates with 3DS prompt on $30–$50 range.',
    confidence: 0.85,
    orchestratorQuery: 'Why is mobile checkout drop-off increasing? LIN-2291.',
  },
  {
    id: 'tkt-003', kind: 'ticket', severity: 'medium',
    title: 'LIN-2293 · Saved payment methods list empty for new users',
    source: 'Linear', sourceIcon: 'LN', sourceColor: '#5e6ad2',
    service: 'payments-api', timestamp: '4 hours ago',
    triageStatus: 'pending',
    orchestratorQuery: 'Why are saved payment methods empty for new users? LIN-2293.',
  },
  {
    id: 'met-001', kind: 'metric', severity: 'critical',
    title: 'Checkout conversion dropped 31.4% → 22.1% in last hour',
    source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed',
    service: 'checkout-v2', timestamp: '5 min ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'Conversion drop correlates exactly with payments-api v2.3.0 deploy at 14:32. Error rate spike causing checkout failures.',
    confidence: 0.96,
    orchestratorQuery: 'Why did checkout conversion drop from 31.4% to 22.1% in the last hour?',
  },
  {
    id: 'met-002', kind: 'metric', severity: 'high',
    title: 'payments-api throughput down 40% since last deploy',
    source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed',
    service: 'payments-api', timestamp: '10 min ago',
    triageStatus: 'triaging',
    orchestratorQuery: 'Why is payments-api throughput down 40% since last deploy?',
  },
  {
    id: 'met-003', kind: 'metric', severity: 'low',
    title: 'payments-api 15% error rate on /v2/checkout endpoint (baseline: 2%)',
    source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed',
    service: 'payments-api', timestamp: '7 min ago',
    triageStatus: 'pending',
    orchestratorQuery: 'Why is /v2/checkout endpoint error rate at 15%?',
  },
  {
    id: 'cust-001', kind: 'customer', severity: 'high',
    title: 'Acme Corp — support: "payment failures since noon"',
    source: 'Zendesk', sourceIcon: 'ZD', sourceColor: '#03363d',
    service: 'payments-api', timestamp: '2 hours ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'Acme Corp reports payment failures affecting 40% of their transactions since noon. Matches error rate spike timeline.',
    confidence: 0.82,
    orchestratorQuery: 'Why is Acme Corp reporting payment failures since noon?',
  },
  {
    id: 'cust-002', kind: 'customer', severity: 'medium',
    title: 'Globex — ticket #88437: invoice generation slow',
    source: 'Zendesk', sourceIcon: 'ZD', sourceColor: '#03363d',
    service: 'invoice-service', timestamp: '1 day ago',
    triageStatus: 'pending',
    orchestratorQuery: 'Why is invoice generation slow for Globex?',
  },
  {
    id: 'ci-001', kind: 'ci', severity: 'critical',
    title: 'CI · payments-api integration tests failing (17/40)',
    source: 'GitHub Actions', sourceIcon: 'GA', sourceColor: '#6e7681',
    service: 'payments-api', timestamp: '4 min ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'TC-004 (HighValue3DSBypass) and TC-009 (PaymentMethodEmpty) fail consistently. Same null pointer issue as alerts.',
    confidence: 0.9,
    branch: 'feature/quick-checkout-v2', commitSha: 'a4f21bc',
    runUrl: 'https://github.com/anvay/payments-api/actions/runs/8841',
    orchestratorQuery: 'Why are 17/40 CI integration tests failing on payments-api?',
  },
  {
    id: 'err-001', kind: 'error', severity: 'high',
    title: 'NullPointerException · QuickCheckoutHandler.java:89',
    source: 'Sentry', sourceIcon: 'SN', sourceColor: '#fb5a40',
    service: 'payments-api', timestamp: '14 min ago',
    triageStatus: 'auto_triaged',
    triageSummary: 'Introduced in v2.3.0 commit a4f21bc. riskScore field on PaymentRequestV2 can be null when amount > 500 and is3DSkipped is true.',
    confidence: 0.96,
    errorCount: 847, firstSeen: '14 min ago',
    orchestratorQuery: 'Explain NullPointerException in QuickCheckoutHandler.java:89',
  },
  {
    id: 'err-002', kind: 'error', severity: 'medium',
    title: 'Connection reset · Redis timeout in session cache',
    source: 'Sentry', sourceIcon: 'SN', sourceColor: '#fb5a40',
    service: 'auth-service', timestamp: '8 min ago',
    triageStatus: 'pending',
    errorCount: 42, firstSeen: '8 min ago',
    orchestratorQuery: 'Why is Redis timing out in auth-service session cache?',
  },
  {
    id: 'err-003', kind: 'error', severity: 'low',
    title: 'Sentry: 412 Precondition Failed · checkout-v2',
    source: 'Sentry', sourceIcon: 'SN', sourceColor: '#fb5a40',
    service: 'checkout-v2', timestamp: '1 hour ago',
    triageStatus: 'pending',
    errorCount: 12, firstSeen: '1 hour ago',
    orchestratorQuery: 'Explain 412 Precondition Failed errors on checkout-v2.',
  },
  {
    id: 'err-004', kind: 'error', severity: 'low',
    title: 'Sentry: 504 Gateway Timeout · payments-api',
    source: 'Sentry', sourceIcon: 'SN', sourceColor: '#fb5a40',
    service: 'payments-api', timestamp: '3 hours ago',
    triageStatus: 'pending',
    errorCount: 8, firstSeen: '3 hours ago',
    orchestratorQuery: 'Explain 504 Gateway Timeout errors on payments-api.',
  },
  {
    id: 'cust-003', kind: 'customer', severity: 'low',
    title: 'Initech — ticket #3381: refund not showing',
    source: 'Zendesk', sourceIcon: 'ZD', sourceColor: '#03363d',
    service: 'payments-api', timestamp: '3 days ago',
    triageStatus: 'pending',
    orchestratorQuery: 'Why is Initech refund not showing?',
  },
  {
    id: 'ci-002', kind: 'ci', severity: 'medium',
    title: 'CI · auth-service type-check warnings (12)',
    source: 'GitHub Actions', sourceIcon: 'GA', sourceColor: '#6e7681',
    service: 'auth-service', timestamp: '1 hour ago',
    triageStatus: 'pending',
    branch: 'main', commitSha: 'b7e91f2',
    orchestratorQuery: 'Why are there 12 type-check warnings on auth-service?',
  },
  {
    id: 'ci-003', kind: 'ci', severity: 'low',
    title: 'CI · checkout-api linter style warnings',
    source: 'GitHub Actions', sourceIcon: 'GA', sourceColor: '#6e7681',
    service: 'checkout-v2', timestamp: '2 hours ago',
    triageStatus: 'pending',
    branch: 'feature/quick-checkout-v2', commitSha: 'd42f17e',
    orchestratorQuery: 'Why are there linter warnings on checkout-api?',
  },
]

export async function alertRoutes(app: FastifyInstance) {
  app.get('/api/alerts', {
    preHandler: [app.authenticate],
  }, async () => {
    return MOCK_ALERTS
  })
}
