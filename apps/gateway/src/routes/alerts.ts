import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

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

// Seed signals for demo when incidents table is empty
const DEMO_SIGNALS: LiveAlert[] = [
  { id: 'alrt-001', kind: 'alert', severity: 'critical', title: 'payments-api error rate 8.4% (threshold: 1%)', source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed', service: 'payments-api', timestamp: '2 min ago', triageStatus: 'auto_triaged', triageSummary: 'Root cause: payments-service v2.3.0 deployed 14 min ago. NullPointerException in QuickCheckoutHandler.java:89 — riskScore null when amount > 500. 3/5 pods in CrashLoopBackOff.', confidence: 0.94, gateId: 'gate-prod-rollback-881', gateStatus: 'pending_approval', orchestratorQuery: 'Why is payments-api error rate at 8.4%? Alert triggered 2 min ago.' },
  { id: 'alrt-002', kind: 'alert', severity: 'critical', title: '3 pods CrashLoopBackOff — payments namespace', source: 'Amazon EKS', sourceIcon: 'EK', sourceColor: '#f59e0b', service: 'payments-api', timestamp: '3 min ago', triageStatus: 'auto_triaged', triageSummary: 'All 3 pods on v2.3.0. Restart count: 5. Same root cause as Datadog error alert — null pointer at startup in QuickCheckoutHandler.', confidence: 0.91, gateId: 'gate-k8s-scale-992', gateStatus: 'auto_approved', orchestratorQuery: 'Why are 3 payments-api pods in CrashLoopBackOff?' },
  { id: 'alrt-003', kind: 'alert', severity: 'high', title: 'auth-service p99 latency spike — 1,240ms (baseline: 180ms)', source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed', service: 'auth-service', timestamp: '8 min ago', triageStatus: 'triaging', orchestratorQuery: 'Why did auth-service p99 latency spike to 1240ms? Baseline is 180ms.' },
  { id: 'err-001', kind: 'error', severity: 'high', title: 'NullPointerException · QuickCheckoutHandler.java:89', source: 'Sentry', sourceIcon: 'SN', sourceColor: '#fb5a40', service: 'payments-api', timestamp: '14 min ago', triageStatus: 'auto_triaged', triageSummary: 'Introduced in v2.3.0 commit a4f21bc. riskScore field on PaymentRequestV2 can be null when amount > 500 and is3DSkipped is true.', confidence: 0.96, errorCount: 847, firstSeen: '14 min ago', orchestratorQuery: 'Explain NullPointerException in QuickCheckoutHandler.java:89' },
  { id: 'met-001', kind: 'metric', severity: 'critical', title: 'Checkout conversion dropped 31.4% → 22.1% in last hour', source: 'Datadog', sourceIcon: 'DD', sourceColor: '#7c3aed', service: 'checkout-v2', timestamp: '5 min ago', triageStatus: 'auto_triaged', triageSummary: 'Conversion drop correlates exactly with payments-api v2.3.0 deploy at 14:32.', confidence: 0.96, orchestratorQuery: 'Why did checkout conversion drop from 31.4% to 22.1% in the last hour?' },
]

interface IncidentRow {
  id: string
  title: string
  severity: string
  status: string
  description: string | null
  suggested_root_cause: string | null
  created_at: Date
}

export async function alertRoutes(app: FastifyInstance) {
  app.get('/api/alerts', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }

    // Query the incidents table for active alerts — RLS filters by tenant
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<IncidentRow[]>`
        SELECT id, title, severity, status, description, suggested_root_cause, created_at
        FROM incidents ORDER BY created_at DESC LIMIT 20
      `
    ).catch(() => [] as IncidentRow[])

    // Map DB incidents to LiveAlert format
    const fromDb: LiveAlert[] = rows.map(r => ({
      id: r.id,
      kind: 'alert' as const,
      severity: (r.severity === 'critical' || r.severity === 'high' || r.severity === 'medium' || r.severity === 'low') ? r.severity : 'medium' as 'critical' | 'high' | 'medium' | 'low',
      title: r.title,
      source: 'Incidents',
      sourceIcon: 'IN',
      sourceColor: '#10b981',
      service: r.description?.split('\n')[0]?.trim() || 'unknown',
      timestamp: timeAgo(r.created_at),
      triageStatus: (r.status === 'active' || r.status === 'investigating') ? 'triaging' : 'pending' as 'auto_triaged' | 'triaging' | 'pending' | 'escalated',
      triageSummary: r.suggested_root_cause ?? undefined,
      orchestratorQuery: `Explain: ${r.title}`,
    }))

    // dev fallback: no incidents in DB — return seed signals for demo visibility
    if (fromDb.length === 0) {
      request.log.warn('alerts: no incidents in DB — returning demo seed signals')
      return DEMO_SIGNALS
    }

    return fromDb
  })
}

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`
  return `${Math.floor(hr / 24)}d ago`
}
