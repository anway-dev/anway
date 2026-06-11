// Freshness daemon — decay kb_entries freshness scores, purge old kb_episodes.
import { createClient } from 'redis'
import { prisma } from '../db/client.js'
import pino from 'pino'

const log = pino({ name: 'freshness-daemon' })

/**
 * Run freshness decay cycle:
 * 1. Decay kb_entries freshness_score based on elapsed time vs ttl_seconds
 * 2. Emit kb:stale event for entries with score < 0.2
 * 3. Purge kb_episodes older than 72h
 */
export async function runFreshnessDecay(redisUrl?: string): Promise<{ decayed: number; stale: number; purged: number }> {
  let pub: ReturnType<typeof createClient> | null = null
  if (redisUrl) {
    pub = createClient({ url: redisUrl })
    await pub.connect().catch(() => { pub = null })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL row_security = off`

      // 1. Decay freshness scores
      const decayed = await tx.$executeRaw`
        UPDATE kb_entries
        SET freshness_score = GREATEST(0.0, 1.0 - (EXTRACT(EPOCH FROM (NOW() - fetched_at)) / NULLIF(ttl_seconds, 0)))
        WHERE tenant_id IS NOT NULL AND ttl_seconds > 0
      `

      // 2. Collect stale entries (score < 0.2)
      const staleEntries = await tx.$queryRaw<{ id: string; tenant_id: string; source: string }[]>`
        SELECT id, tenant_id::text, source FROM kb_entries WHERE freshness_score < 0.2 LIMIT 100
      `

      // 3. Purge old episodes
      const purged = await tx.$executeRaw`
        DELETE FROM kb_episodes WHERE created_at < NOW() - INTERVAL '72 hours'
      `

      return { decayed: Number(decayed), stale: staleEntries, purged: Number(purged) }
    })

    // Emit kb:stale Redis event
    if (pub && result.stale.length > 0) {
      await pub.publish('kb:stale', JSON.stringify({
        count: result.stale.length,
        sources: [...new Set(result.stale.map(e => e.source))],
      })).catch(() => {})
    }

    log.info({ decayed: result.decayed, stale: result.stale.length, purged: result.purged }, 'freshness decay cycle complete')
    return { decayed: result.decayed, stale: result.stale.length, purged: result.purged }
  } catch (err) {
    log.error({ err }, 'freshness decay failed')
    return { decayed: 0, stale: 0, purged: 0 }
  } finally {
    await pub?.disconnect().catch(() => {})
  }
}
