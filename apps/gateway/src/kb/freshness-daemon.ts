// Freshness daemon — M4-T3: purge old episodes, skip if empty.
import { prisma } from '../db/client.js'
import pino from 'pino'

const log = pino({ name: 'freshness-daemon' })

/**
 * Cleanup old kb_episodes. Runs as transaction with RLS disabled (maintenance).
 * - Episodes older than 72h are deleted.
 * - Skips if table is empty.
 */
export async function runFreshnessDecay(): Promise<{ stale: number; purged: number }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL row_security = off`

      const count = await tx.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) FROM kb_episodes
      `
      if (Number(count[0]!.count) === 0) return { stale: 0, purged: 0 }

      const stale = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM kb_episodes WHERE created_at < NOW() - INTERVAL '72 hours' LIMIT 100
      `

      const purged = await tx.$executeRaw`
        DELETE FROM kb_episodes WHERE created_at < NOW() - INTERVAL '72 hours'
      `

      return { stale: stale.length, purged: Number(purged) }
    })

    log.info(result, 'freshness decay cycle complete')
    return result
  } catch (err) {
    log.error({ err }, 'freshness decay failed')
    return { stale: 0, purged: 0 }
  }
}
