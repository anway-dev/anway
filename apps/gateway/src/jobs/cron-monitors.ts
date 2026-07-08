import { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

export interface CronJobRecord {
  id: string
  name: string
  schedule: string
  job_type: string
  enabled: boolean
  last_run_at: Date | null
  last_result: Record<string, unknown> | null
}

// Cloud connector types for cloud-dependent monitors.
const CLOUD_CONNECTOR_TYPES = ['aws', 'gcp', 'azure', 'aws-cloudwatch', 'gcp-monitoring', 'azure-monitor']

async function hasCloudConnector(tenantId: string): Promise<boolean> {
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND enabled = true
        AND connector_type IN (${Prisma.join(CLOUD_CONNECTOR_TYPES)})
    `
  ).catch(() => [{ count: 0n }])
  return Number(rows[0]?.count ?? 0) > 0
}

// ---------------------------------------------------------------------------
// ServiceHealthSweep — query service entities + incident correlation
// ---------------------------------------------------------------------------
export class ServiceHealthSweep {
  async run(tenantId: string): Promise<{ status: string; findings: number; services: number; unhealthyServices: string[] }> {
    // Get services with their health metadata from the entities table
    const services = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ name: string; metadata: Record<string, unknown> }>>`
        SELECT name, metadata FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Service'
        LIMIT 200
      `
    ).catch(() => [] as Array<{ name: string; metadata: Record<string, unknown> }>)

    // Correlate with active incidents
    const incidents = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ title: string }>>`
        SELECT title FROM incidents
        WHERE tenant_id = ${tenantId}::uuid AND status IN ('active', 'investigating')
      `
    ).catch(() => [] as Array<{ title: string }>)

    // Determine unhealthy services: those with degraded health metadata or mentioned in active incidents
    const unhealthy = services.filter(s => {
      const meta = s.metadata ?? {}
      const health = typeof meta.health === 'string' ? meta.health : null
      const degraded = typeof meta.degraded === 'boolean' ? meta.degraded : false
      if (health === 'Degraded' || health === 'Error' || degraded) return true
      return incidents.some(i => i.title.toLowerCase().includes(s.name.toLowerCase()))
    })

    return {
      status: unhealthy.length > 0 ? 'degraded' : 'ok',
      findings: unhealthy.length + incidents.length,
      services: services.length,
      unhealthyServices: unhealthy.map(s => s.name),
    }
  }
}

// ---------------------------------------------------------------------------
// SloBurnCheck — real error-budget burn rate from entity metadata
// ---------------------------------------------------------------------------
export class SloBurnCheck {
  async run(tenantId: string): Promise<{ status: string; services: number; burningServices: Array<{ name: string; burnRate1h: number; burnRate6h: number }> }> {
    const services = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ name: string; metadata: Record<string, unknown> }>>`
        SELECT name, metadata FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Service'
        LIMIT 200
      `
    ).catch(() => [] as Array<{ name: string; metadata: Record<string, unknown> }>)

    // Confirmed live via independent review: no connector or job anywhere
    // in this codebase ever writes errorBudget/burnRate1h/burnRate6h onto
    // a Service entity's metadata — computing real SLO burn rate requires
    // a per-service SLO target plus a live Datadog/Prometheus query, which
    // doesn't exist yet. Previously this defaulted every missing field to
    // 0/1.0 and reported 'ok', indistinguishable from "checked every
    // service and none are burning" — a false-clean signal. Distinguish
    // "real SLO data exists and nothing is burning" from "no service here
    // has ever had real SLO data computed" so this doesn't look like a
    // working monitor when it's actually never been fed real numbers.
    const withData = services.filter(s => {
      const meta = s.metadata ?? {}
      return typeof meta.burnRate1h === 'number' || typeof meta.burnRate6h === 'number' || typeof meta.errorBudget === 'number'
    })

    const burning = withData
      .map(s => {
        const meta = s.metadata ?? {}
        const errorBudget = typeof meta.errorBudget === 'number' ? meta.errorBudget : 1.0
        const burnRate1h = typeof meta.burnRate1h === 'number' ? meta.burnRate1h : 0
        const burnRate6h = typeof meta.burnRate6h === 'number' ? meta.burnRate6h : 0
        return { name: s.name, burnRate1h, burnRate6h, errorBudget }
      })
      .filter(s => s.burnRate1h > 1.0 || s.burnRate6h > 1.0) // >1x = burning faster than replenishment

    return {
      status: withData.length === 0 ? 'no_data' : burning.length > 0 ? 'burning' : 'ok',
      services: services.length,
      burningServices: burning.map(b => ({ name: b.name, burnRate1h: b.burnRate1h, burnRate6h: b.burnRate6h })),
    }
  }
}

// ---------------------------------------------------------------------------
// DeployHealthReport — aggregate pipeline_stage_runs for last 24h
// ---------------------------------------------------------------------------
export class DeployHealthReport {
  async run(tenantId: string): Promise<{ status: string; deploys24h: number; failedDeploys: number; avgDurationMs: number | null }> {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ count: bigint; failed: bigint; avg_ms: number | null }>>`
        SELECT
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::float as avg_ms
        FROM pipeline_stage_runs
        WHERE tenant_id = ${tenantId}::uuid
          AND started_at > NOW() - INTERVAL '24 hours'
      `
    ).catch(() => [{ count: 0n, failed: 0n, avg_ms: null }] as Array<{ count: bigint; failed: bigint; avg_ms: number | null }>)

    const deploys24h = Number(rows[0]?.count ?? 0n)
    const failedDeploys = Number(rows[0]?.failed ?? 0n)
    return {
      status: failedDeploys > 0 ? 'degraded' : 'ok',
      deploys24h,
      failedDeploys,
      avgDurationMs: rows[0]?.avg_ms ?? null,
    }
  }
}

// ---------------------------------------------------------------------------
// OncallMorningBrief — compose real data into text brief + write to signal_inbox
// ---------------------------------------------------------------------------
export class OncallMorningBrief {
  async run(tenantId: string): Promise<{ status: string; brief: string }> {
    // Open incidents
    const openIncidents = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM incidents
        WHERE tenant_id = ${tenantId}::uuid AND status IN ('active', 'investigating')
          AND created_at > NOW() - INTERVAL '24 hours'
      `
    ).catch(() => [{ count: 0n }])

    // Firing alerts
    const firingAlerts = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Alert'
          AND (metadata->>'status' = 'firing' OR metadata->>'severity' = 'critical')
      `
    ).catch(() => [{ count: 0n }])

    // Pending gates
    const pendingGates = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM gate_events
        WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'
      `
    ).catch(() => [{ count: 0n }])

    // Deploys in last 24h
    const recentDeploys = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM pipeline_stage_runs
        WHERE tenant_id = ${tenantId}::uuid AND started_at > NOW() - INTERVAL '24 hours'
      `
    ).catch(() => [{ count: 0n }])

    const openCount = Number(openIncidents[0]?.count ?? 0n)
    const alertCount = Number(firingAlerts[0]?.count ?? 0n)
    const gateCount = Number(pendingGates[0]?.count ?? 0n)
    const deployCount = Number(recentDeploys[0]?.count ?? 0n)

    const brief = [
      `Morning Brief — ${new Date().toISOString().slice(0, 10)}`,
      `${openCount} open incidents in last 24h`,
      `${alertCount} critical alerts firing`,
      `${gateCount} pending gate approvals`,
      `${deployCount} deploys in last 24h`,
    ].join('. ') + '.'

    // Write to signal_inbox for the Signals view
    try {
      await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          INSERT INTO signal_inbox (tenant_id, event_type, summary, source, payload, created_at)
          VALUES (${tenantId}::uuid, 'morning_brief', ${brief}, 'cron',
                  ${JSON.stringify({ openIncidents: openCount, firingAlerts: alertCount, pendingGates: gateCount, deploys: deployCount })}::jsonb, NOW())
        `
      )
    } catch { /* non-blocking */ }

    return { status: 'ok', brief }
  }
}

// ---------------------------------------------------------------------------
// CloudSecurityScan — real findings from cloud connector entity data
// ---------------------------------------------------------------------------
export class CloudSecurityScan {
  async run(tenantId: string): Promise<{ status: string; findings: number; details: Array<{ severity: string; summary: string }> }> {
    const configured = await hasCloudConnector(tenantId)
    if (!configured) return { status: 'unconfigured', findings: 0, details: [] }

    // Confirmed live via independent review: no cloud connector in this
    // codebase (aws-cloudwatch, aws-health, azure-monitor, gcp-monitoring)
    // ever writes a 'Finding' entity — none of them wraps a real security
    // findings API (AWS Security Hub, GCP Security Command Center, Azure
    // Defender). This query has always returned zero rows for every
    // tenant. Previously that silently reported 'ok' — indistinguishable
    // from "scanned and found nothing" when the truth is "no security
    // findings source has ever been wired up". Report 'no_data' instead so
    // this doesn't look like a working scan.
    const totalFindingRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Finding'
      `
    ).catch(() => [{ count: 0n }] as Array<{ count: bigint }>)
    if (Number(totalFindingRows[0]?.count ?? 0n) === 0) {
      return { status: 'no_data', findings: 0, details: [] }
    }

    const findingRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ name: string; metadata: Record<string, unknown> }>>`
        SELECT name, metadata FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Finding'
        LIMIT 100
      `
    ).catch(() => [] as Array<{ name: string; metadata: Record<string, unknown> }>)

    const details = findingRows.map(f => ({
      severity: (typeof f.metadata?.severity === 'string' ? f.metadata.severity : 'medium') as string,
      summary: f.name,
    }))

    const criticalOrHigh = details.filter(d => d.severity === 'critical' || d.severity === 'high')
    return {
      status: criticalOrHigh.length > 0 ? 'findings' : 'ok',
      findings: details.length,
      details,
    }
  }
}

// ---------------------------------------------------------------------------
// CostAnomalyDetection — daily spend vs trailing-7-day baseline
// ---------------------------------------------------------------------------
export class CostAnomalyDetection {
  async run(tenantId: string): Promise<{ status: string; anomalies: number; dailySpend: number; baseline7dMean: number }> {
    const configured = await hasCloudConnector(tenantId)
    if (!configured) return { status: 'unconfigured', anomalies: 0, dailySpend: 0, baseline7dMean: 0 }

    // Confirmed live via independent review: no cloud connector in this
    // codebase ever writes a 'Cost' entity — none wraps a real billing API
    // (AWS Cost Explorer, GCP Billing, Azure Cost Management). This query
    // has always returned zero rows for every tenant. Previously the empty
    // case reported 'ok' — indistinguishable from "checked spend, no
    // anomaly" when the truth is "no cost data source has ever been wired
    // up". Report 'no_data' instead so this doesn't look like a working
    // cost monitor.
    const costRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ name: string; metadata: Record<string, unknown> }>>`
        SELECT name, metadata FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Cost'
        ORDER BY (metadata->>'date') DESC
        LIMIT 8
      `
    ).catch(() => [] as Array<{ name: string; metadata: Record<string, unknown> }>)

    if (costRows.length === 0) return { status: 'no_data', anomalies: 0, dailySpend: 0, baseline7dMean: 0 }

    // Compute daily spend and 7-day baseline
    const spends = costRows.map(r => {
      const meta = r.metadata ?? {}
      return typeof meta.amount === 'number' ? meta.amount : parseFloat(String(meta.amount ?? '0')) || 0
    })
    const dailySpend = spends[0] ?? 0
    const trailing7d = spends.slice(1, 8)
    const baseline7dMean = trailing7d.length > 0
      ? trailing7d.reduce((a, b) => a + b, 0) / trailing7d.length
      : dailySpend

    // Flag anomaly if daily spend exceeds 3σ above 7-day mean
    const variance = trailing7d.length > 1
      ? trailing7d.reduce((s, v) => s + (v - baseline7dMean) ** 2, 0) / trailing7d.length
      : 0
    const stdDev = Math.sqrt(variance)
    const threshold = baseline7dMean + 3 * stdDev
    const anomalies = dailySpend > threshold && baseline7dMean > 0 ? 1 : 0

    return { status: anomalies > 0 ? 'anomaly' : 'ok', anomalies, dailySpend, baseline7dMean }
  }
}

// ---------------------------------------------------------------------------
// IncidentRetrospective — group resolved incidents by service + root cause
// ---------------------------------------------------------------------------
export class IncidentRetrospective {
  async run(tenantId: string): Promise<{ status: string; resolved: number; byService: Array<{ service: string; count: number }> }> {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ title: string; suggested_root_cause: string | null; count: bigint }>>`
        SELECT title, suggested_root_cause, COUNT(*) as count FROM incidents
        WHERE tenant_id = ${tenantId}::uuid AND status = 'resolved'
          AND resolved_at > NOW() - INTERVAL '7 days'
        GROUP BY title, suggested_root_cause
        ORDER BY count DESC LIMIT 50
      `
    ).catch(() => [] as Array<{ title: string; suggested_root_cause: string | null; count: bigint }>)

    // Group by service name extracted from title
    const byService = new Map<string, number>()
    for (const row of rows) {
      const serviceMatch = row.title.match(/([a-z][a-z0-9-]*api|[a-z][a-z0-9-]*service|[a-z][a-z0-9-]*gateway)/i)
      const service = serviceMatch ? serviceMatch[0] : 'unknown'
      byService.set(service, (byService.get(service) ?? 0) + Number(row.count))
    }

    const resolved = rows.reduce((sum, r) => sum + Number(r.count), 0)
    return {
      status: 'ok',
      resolved,
      byService: [...byService.entries()].map(([service, count]) => ({ service, count })),
    }
  }
}

// ---------------------------------------------------------------------------
// DataRetentionJob — purge old data (not part of T13, kept as-is)
// ---------------------------------------------------------------------------
export class DataRetentionJob {
  async run(tenantId: string): Promise<{ status: string; auditPurged: number; automationPurged: number }> {
    let auditPurged = 0
    try {
      const r = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          DELETE FROM audit_events WHERE tenant_id = ${tenantId}::uuid AND created_at < NOW() - INTERVAL '90 days'
        `
      )
      auditPurged = r
    } catch { /* audit retention best-effort */ }
    return { status: 'ok', auditPurged, automationPurged: 0 }
  }
}
