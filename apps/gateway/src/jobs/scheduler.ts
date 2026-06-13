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

async function updateLastRunById(tenantId: string, jobId: string, result: unknown): Promise<void> {
  try {
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE cron_jobs
        SET last_run_at = NOW(), last_result = ${JSON.stringify(result)}::jsonb
        WHERE tenant_id = ${tenantId}::uuid AND id = ${jobId}::uuid
      `
    )
  } catch { /* best-effort */ }
  try {
    const status = (result as { status?: string } | null | undefined)?.status ?? 'ok'
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        INSERT INTO automation_runs (tenant_id, kind, ref_id, status, summary)
        VALUES (${tenantId}::uuid, 'cron', ${jobId}::uuid, ${status}, ${JSON.stringify(result)}::jsonb)
      `
    )
  } catch { /* best-effort — run history is non-critical */ }
}

// User-creatable monitor types → implementations
export const MONITOR_IMPLS: Record<string, { new (): { run(tenantId: string): Promise<unknown> } }> = {
  service_health_sweep: ServiceHealthSweep,
  slo_burn_check: SloBurnCheck,
  deploy_health_report: DeployHealthReport,
  oncall_morning_brief: OncallMorningBrief,
}

interface UserMonitorRow { id: string; tenant_id: string; name: string; schedule: string; job_type: string }

/** Schedule a user-created cron_jobs row. Worker re-checks enabled in DB before each run. */
export async function registerUserMonitor(scheduler: IScheduler, row: UserMonitorRow): Promise<void> {
  const Impl = MONITOR_IMPLS[row.job_type]
  if (!Impl) return
  await scheduler.register({
    id: `user:${row.id}`,
    name: `user:${row.id}`,
    schedule: row.schedule,
    async run() {
      const live = await withTenant(prisma, row.tenant_id, (tx) =>
        tx.$queryRaw<{ enabled: boolean }[]>`
          SELECT enabled FROM cron_jobs WHERE id = ${row.id}::uuid AND tenant_id = ${row.tenant_id}::uuid
        `
      ).catch(() => [] as { enabled: boolean }[])
      if (!live[0]?.enabled) return  // disabled or deleted — skip
      const result = await new Impl().run(row.tenant_id)
      await updateLastRunById(row.tenant_id, row.id, result)
    },
  })
}

// Module-level handle so routes can register monitors created at runtime
let activeScheduler: IScheduler | null = null
export function getActiveScheduler(): IScheduler | null { return activeScheduler }

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
      return runFreshnessDecay(redisUrl)
    },
  })

  // User-created monitors (POST /api/automations/monitors) — schedule from DB
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; tenant_id: string; name: string; schedule: string; job_type: string }>>`
      SELECT id, tenant_id, name, schedule, job_type FROM cron_jobs WHERE enabled = true
    `
    for (const row of rows) await registerUserMonitor(scheduler, row)
  } catch { /* table may not exist on first boot — monitors register on create */ }

  activeScheduler = scheduler
  return scheduler
}
