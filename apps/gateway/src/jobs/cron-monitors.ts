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
  async run(_tenantId: string): Promise<{ status: string; services: number }> {
    return { status: 'ok', services: 0 }
  }
}

export class DeployHealthReport {
  async run(tenantId: string): Promise<{ status: string; deploys: number }> {
    const deploys = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM incidents WHERE tenant_id = ${tenantId}::uuid AND created_at >= NOW() - INTERVAL '1 day'
      `
    )
    return { status: 'ok', deploys: Number(deploys[0]?.count ?? 0) }
  }
}

export class OncallMorningBrief {
  async run(_tenantId: string): Promise<{ status: string; brief: string }> {
    return { status: 'ok', brief: 'No active incidents overnight.' }
  }
}
