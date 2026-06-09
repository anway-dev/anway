import { createClient } from 'redis'
import type { IGateSink, GateEvent } from '@anvay/agent'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import pino from 'pino'

const log = pino({ name: 'redis-gate-sink' })

const GATE_KEY_PREFIX = 'gate:'
const GATE_TTL_SECONDS = 600 // must exceed orchestrator poll timeout (default 5 min) + max human response window

/**
 * Redis-backed IGateSink. Gate events persisted to Postgres + Redis cache.
 *
 * - push: inserts pending row into gate_events, stores event in Redis, publishes gate:required
 * - poll: reads key `gate:<gateId>:decision` from Redis
 * - record: sets `gate:<gateId>:decision` in Redis — Postgres update is gate-decide-route.ts responsibility
 */
export class RedisGateSink implements IGateSink {
  private pub: ReturnType<typeof createClient> | null = null

  constructor(private readonly redisUrl: string) {}

  private async getPub(): Promise<ReturnType<typeof createClient>> {
    if (!this.pub) {
      this.pub = createClient({
        url: this.redisUrl,
        socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
      })
      this.pub.on('error', (err) => log.error({ err }, 'RedisGateSink connection error'))
      await this.pub.connect()
    }
    return this.pub
  }

  async push(event: GateEvent): Promise<string> {
    // Persist to Postgres (audit trail) — withTenant sets RLS GUC
    try {
      await withTenant(prisma, event.tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, tool_call_id, created_at)
          VALUES (${event.id}::uuid, ${event.tenantId}::uuid, ${event.userId}::uuid, ${event.sessionId}::uuid,
            ${event.toolName}, ${JSON.stringify(event.args)}::jsonb, ${event.connectorId},
            'pending', ${event.toolCallId}, ${event.createdAt.toISOString()}::timestamptz)
        `
      )
    } catch (err) {
      // Best-effort — don't block gate flow on audit insert failure
      log.warn({ err, gateId: event.id }, 'gate_events insert failed')
    }

    // Cache in Redis + notify
    const pub = await this.getPub()
    const key = `${GATE_KEY_PREFIX}${event.id}`
    await pub.setEx(key, GATE_TTL_SECONDS, JSON.stringify(event))
    await pub.publish('gate:required', JSON.stringify({ gateId: event.id, toolName: event.toolName }))
    return event.id
  }

  async poll(gateId: string): Promise<'approved' | 'rejected' | null> {
    try {
      const c = await this.getPub()
      const key = `${GATE_KEY_PREFIX}${gateId}:decision`
      const value = await c.get(key)
      if (value === 'approved' || value === 'rejected') return value
      return null
    } catch {
      return null
    }
  }

  async record(gateId: string, decision: 'approved' | 'rejected', _decidedBy: string): Promise<void> {
    // Postgres update is handled by gate-decide-route.ts — this only sets Redis key
    const pub = await this.getPub()
    await pub.setEx(`${GATE_KEY_PREFIX}${gateId}:decision`, GATE_TTL_SECONDS, decision)
  }
}
