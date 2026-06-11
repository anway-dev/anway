// Freshness daemon — decay kb_entries freshness scores, purge old kb_episodes.
// Iterates tenants explicitly — no RLS bypass.
import { createClient } from 'redis'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import pino from 'pino'

const log = pino({ name: 'freshness-daemon' })

export async function runFreshnessDecay(redisUrl?: string): Promise<{ decayed: number; stale: number; purged: number }> {
  let pub: ReturnType<typeof createClient> | null = null
  if (redisUrl) {
    pub = createClient({ url: redisUrl })
    await pub.connect().catch(() => { pub = null })
  }

  try {
    const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM tenants`.catch(() => [])
    if (tenants.length === 0) return { decayed: 0, stale: 0, purged: 0 }

    let totalDecayed = 0
    let totalPurged = 0
    let allStale: Array<{ id: string; tenant_id: string; source: string }> = []

    for (const { id } of tenants) {
      await withTenant(prisma, id, async (tx) => {
        const decayed = await tx.$executeRaw`
          UPDATE kb_entries
          SET freshness_score = GREATEST(0.0, 1.0 - (EXTRACT(EPOCH FROM (NOW() - fetched_at)) / NULLIF(ttl_seconds, 0)))
          WHERE tenant_id = ${id}::uuid AND ttl_seconds > 0
        `
        totalDecayed += Number(decayed)

        const staleEntries = await tx.$queryRaw<{ id: string; tenant_id: string; source: string }[]>`
          SELECT id, tenant_id::text, source FROM kb_entries WHERE freshness_score < 0.2 LIMIT 100
        `
        allStale.push(...staleEntries)

        const purged = await tx.$executeRaw`
          DELETE FROM kb_episodes WHERE tenant_id = ${id}::uuid AND created_at < NOW() - INTERVAL '72 hours'
        `
        totalPurged += Number(purged)
      })
    }

    if (pub && allStale.length > 0) {
      await pub.publish('kb:stale', JSON.stringify({
        count: allStale.length,
        sources: [...new Set(allStale.map(e => e.source))],
      })).catch(() => {})
    }

    log.info({ decayed: totalDecayed, stale: allStale.length, purged: totalPurged }, 'freshness decay cycle complete')
    return { decayed: totalDecayed, stale: allStale.length, purged: totalPurged }
  } catch (err) {
    log.error({ err }, 'freshness decay failed')
    return { decayed: 0, stale: 0, purged: 0 }
  } finally {
    await pub?.disconnect().catch(() => {})
  }
}
