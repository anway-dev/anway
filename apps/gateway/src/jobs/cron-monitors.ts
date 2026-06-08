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

export class ServiceHealthSweep {
  async run(tenantId: string): Promise<{ status: string; findings: number }> {
    const connectors = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ id: string; type: string }[]>`
        SELECT id, type FROM connectors WHERE tenant_id = ${tenantId}::uuid
      `
    )
    return { status: 'ok', findings: connectors.length }
  }
}

export class SloBurnCheck {
  async run(tenantId: string): Promise<{ status: string; services: number }> {
    // Count services from entities table (real query — monitor stub removed)
    const svcs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM entities WHERE tenant_id = ${tenantId}::uuid AND type = 'Service'`
    )
    return { status: 'ok', services: Number(svcs[0]?.count ?? 0) }
  }
}

export class DeployHealthReport {
  async run(tenantId: string): Promise<{ status: string; deploys: number }> {
    // Count Deploy entities from entities table (not incidents — fix for CLAUDE.md spec)
    const deploys = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM entities WHERE tenant_id = ${tenantId}::uuid AND type = 'Deploy'`
    )
    return { status: 'ok', deploys: Number(deploys[0]?.count ?? 0) }
  }
}

export class OncallMorningBrief {
  async run(tenantId: string): Promise<{ status: string; brief: string }> {
    const openIncidents = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM incidents WHERE tenant_id = ${tenantId}::uuid AND status = 'open' AND created_at > NOW() - INTERVAL '24h'`
    )
    const firingAlerts = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM entities WHERE tenant_id = ${tenantId}::uuid AND type = 'Alert' AND metadata->>'status' = 'firing'`
    )
    const openCount = Number(openIncidents[0]?.count ?? 0)
    const alertCount = Number(firingAlerts[0]?.count ?? 0)
    return { status: 'ok', brief: `${openCount} open incidents, ${alertCount} firing alerts in last 24h.` }
  }
}
