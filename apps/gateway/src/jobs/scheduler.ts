import cron from 'node-cron'
import { prisma } from '../db/client.js'
import { ServiceHealthSweep, SloBurnCheck, DeployHealthReport, OncallMorningBrief } from './cron-monitors.js'

export function startCronScheduler(): void {
  cron.schedule('*/5 * * * *', async () => {
    const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors`
    for (const { id } of tenants) {
      const sweep = new ServiceHealthSweep()
      await sweep.run(id)
    }
  })

  cron.schedule('0 * * * *', async () => {
    const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors`
    for (const { id } of tenants) {
      const slo = new SloBurnCheck()
      await slo.run(id)
      const report = new DeployHealthReport()
      await report.run(id)
    }
  })

  cron.schedule('0 8 * * *', async () => {
    const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM connectors`
    for (const { id } of tenants) {
      const brief = new OncallMorningBrief()
      await brief.run(id)
    }
  })
}
