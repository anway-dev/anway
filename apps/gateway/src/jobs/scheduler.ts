// TODO: replace node-cron with Trigger.dev or BullMQ per PRODUCT.md §11 decision.
// node-cron has no persistence or retry — jobs are lost on restart.
import cron from 'node-cron'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { ServiceHealthSweep, SloBurnCheck, DeployHealthReport, OncallMorningBrief } from './cron-monitors.js'

async function updateLastRun(tenantId: string, jobType: string, result: unknown): Promise<void> {
  try {
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE cron_jobs
        SET last_run_at = NOW(), last_result = ${JSON.stringify(result)}::jsonb
        WHERE tenant_id = ${tenantId}::uuid AND job_type = ${jobType}
      `
    )
  } catch {
    // Best-effort — don't let audit update break the job pipeline
  }
}

export function startCronScheduler(): void {
  cron.schedule('*/5 * * * *', async () => {
    const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors`
    for (const { id } of tenants) {
      const sweep = new ServiceHealthSweep()
      const result = await sweep.run(id)
      await updateLastRun(id, 'service_health_sweep', result)
    }
  })

  cron.schedule('0 * * * *', async () => {
    const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors`
    for (const { id } of tenants) {
      const slo = new SloBurnCheck()
      const sloResult = await slo.run(id)
      await updateLastRun(id, 'slo_burn_check', sloResult)
      const report = new DeployHealthReport()
      const reportResult = await report.run(id)
      await updateLastRun(id, 'deploy_health_report', reportResult)
    }
  })

  cron.schedule('0 8 * * *', async () => {
    const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors`
    for (const { id } of tenants) {
      const brief = new OncallMorningBrief()
      const result = await brief.run(id)
      await updateLastRun(id, 'oncall_morning_brief', result)
    }
  })
}
