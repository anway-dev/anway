// Freshness daemon — M4-T3: exponential decay, staleness events, purge.
// Registered as an IScheduler job (not setInterval per CLAUDE.md §11).
import { createClient } from 'redis'
import { prisma } from '../db/client.js'
import pino from 'pino'

const log = pino({ name: 'freshness-daemon' })

/**
 * Decay freshness using exponential decay: freshness = 1.0 * exp(-elapsed / ttl).
 * Runs as a transaction with RLS disabled (global maintenance — not tenant-scoped).
 *
 * - freshness < 0.5 → emit kb:stale Redis event
 * - freshness <= 0   → purged from working context
 */
export async function runFreshnessDecay(redisUrl: string): Promise<{ decayed: number; stale: number; purged: number }> {
  const pub = createClient({ url: redisUrl })
  await pub.connect()

  // Run maintenance in a transaction with RLS disabled (admin operation)
  const [decayedRows, staleEntries, purgedRows] = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL row_security = off`

    const decayed = await tx.$executeRaw`
      UPDATE kb_entries
      SET freshness_score = GREATEST(0, 1.0 * EXP(
        -EXTRACT(EPOCH FROM (NOW() - fetched_at)) / NULLIF(ttl_seconds, 0)
      ))
      WHERE freshness_score > 0
    `

    const stale = await tx.$queryRaw<{ id: string; tenant_id: string; entity_id: string | null }[]>`
      SELECT id, tenant_id, entity_id FROM kb_entries
      WHERE freshness_score < 0.5 AND freshness_score > 0
    `

    const purged = await tx.$executeRaw`DELETE FROM kb_entries WHERE freshness_score <= 0`
    return [decayed, stale, purged] as const
  })

  for (const entry of staleEntries) {
    await pub.publish('kb:stale', JSON.stringify({
      entryId: entry.id,
      tenantId: entry.tenant_id,
      entityId: entry.entity_id,
      freshness: 0.5,
    }))
  }

  await pub.disconnect()
  const result = { decayed: Number(decayedRows), stale: staleEntries.length, purged: Number(purgedRows) }
  log.info(result, 'freshness decay cycle complete')
  return result
}
