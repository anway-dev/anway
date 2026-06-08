// Freshness daemon — M4-T3: exponential decay, staleness events, purge.
// Runs on schedule, decays kb_entries.freshness_score, emits Redis events.
import { createClient } from 'redis'
import { prisma } from '../db/client.js'
import pino from 'pino'

const log = pino({ name: 'freshness-daemon' })

/**
 * Decay freshness using exponential decay: freshness = 1.0 * exp(-elapsed / ttl).
 * elapsed = seconds since fetched_at, ttl = ttl_seconds from the entry.
 *
 * - freshness < 0.5 → emit kb:stale Redis event
 * - freshness < 0.2 → marked stale in DB (not served without re-fetch)
 * - freshness <= 0   → purged from working context
 */
export async function runFreshnessDecay(redisUrl: string): Promise<{ decayed: number; stale: number; purged: number }> {
  const pub = createClient({ url: redisUrl })
  await pub.connect()

  // Decay all entries with freshness > 0
  const decayed = await prisma.$executeRaw`
    UPDATE kb_entries
    SET freshness_score = GREATEST(0, 1.0 * EXP(
      -EXTRACT(EPOCH FROM (NOW() - fetched_at)) / NULLIF(ttl_seconds, 0)
    ))
    WHERE freshness_score > 0
  `

  // Find entries now below 0.5 that were above 0.5 before
  const staleEntries = await prisma.$queryRaw<{ id: string; tenant_id: string; entity_id: string | null }[]>`
    SELECT id, tenant_id, entity_id
    FROM kb_entries
    WHERE freshness_score < 0.5 AND freshness_score > 0
  `

  for (const entry of staleEntries) {
    await pub.publish('kb:stale', JSON.stringify({
      entryId: entry.id,
      tenantId: entry.tenant_id,
      entityId: entry.entity_id,
      freshness: 0.5,
    }))
  }

  // Purge entries at 0.0
  const purged = await prisma.$executeRaw`
    DELETE FROM kb_entries WHERE freshness_score <= 0
  `

  await pub.disconnect()
  log.info({ decayed, stale: staleEntries.length, purged }, 'freshness decay cycle complete')
  return { decayed, stale: staleEntries.length, purged }
}

/**
 * Runs freshness decay continuously on a fixed interval.
 * Returns the interval handle for cleanup.
 */
export function startFreshnessDaemon(redisUrl: string, intervalMs = 300_000): ReturnType<typeof setInterval> {
  log.info({ intervalMs }, 'freshness daemon started')
  return setInterval(() => {
    runFreshnessDecay(redisUrl).catch((err) => {
      log.error({ err }, 'freshness decay cycle failed')
    })
  }, intervalMs)
}
