// Cron jobs factory — creates IScheduler backed by BullMQ.
// node-cron removed per CLAUDE.md §11: no in-process cron in production.
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { ServiceHealthSweep, SloBurnCheck, DeployHealthReport, OncallMorningBrief } from './cron-monitors.js'
import { SchedulerFactory } from '../scheduler/factory.js'
import { runFreshnessDecay } from '../kb/freshness-daemon.js'
import type { IScheduler } from '@anvay/agent'

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

export async function createCronJobs(redisUrl: string): Promise<IScheduler> {
  const scheduler = SchedulerFactory.create(redisUrl)

  await scheduler.register({
    id: 'service-health-sweep',
    name: 'service_health_sweep',
    schedule: '*/5 * * * *',
    async run() {
      const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors LIMIT 1000`
      for (const { id } of tenants) {
        const sweep = new ServiceHealthSweep()
        const result = await sweep.run(id)
        await updateLastRun(id, 'service_health_sweep', result)
      }
    },
  })

  await scheduler.register({
    id: 'hourly-slo-deploy',
    name: 'hourly_slo_deploy',
    schedule: '0 * * * *',
    async run() {
      const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors LIMIT 1000`
      for (const { id } of tenants) {
        const slo = new SloBurnCheck()
        const sloResult = await slo.run(id)
        await updateLastRun(id, 'slo_burn_check', sloResult)
        const report = new DeployHealthReport()
        const reportResult = await report.run(id)
        await updateLastRun(id, 'deploy_health_report', reportResult)
      }
    },
  })

  await scheduler.register({
    id: 'oncall-morning-brief',
    name: 'oncall_morning_brief',
    schedule: '0 8 * * *',
    async run() {
      const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors LIMIT 1000`
      for (const { id } of tenants) {
        const brief = new OncallMorningBrief()
        const result = await brief.run(id)
        await updateLastRun(id, 'oncall_morning_brief', result)
      }
    },
  })

  // Freshness daemon — replaces setInterval with persistent IScheduler job
  await scheduler.register({
    id: 'freshness-decay',
    name: 'freshness_decay',
    schedule: '*/5 * * * *',
    async run() {
      return runFreshnessDecay()
    },
  })

  return scheduler
}
