import { createClient } from 'redis'
import type { IGateSink, GateEvent } from '@anvay/agent'
import { prisma } from '../db/client.js'

const GATE_KEY_PREFIX = 'gate:'
const GATE_TTL_SECONDS = 60

/**
 * Redis-backed IGateSink. Gate events persisted to Postgres + Redis cache.
 *
 * - push: inserts pending row into gate_events, stores event in Redis, publishes gate:required
 * - poll: reads key `gate:<gateId>:decision` from Redis
 * - record: sets `gate:<gateId>:decision` = "approved" | "rejected" in Redis
 */
export class RedisGateSink implements IGateSink {
  private pub: ReturnType<typeof createClient> | null = null

  constructor(private readonly redisUrl: string) {}

  private async getPub(): Promise<ReturnType<typeof createClient>> {
    if (!this.pub) {
      this.pub = createClient({ url: this.redisUrl })
      await this.pub.connect()
    }
    return this.pub
  }

  async push(event: GateEvent): Promise<string> {
    // Persist to Postgres (audit trail)
    try {
      await prisma.$executeRaw`
        INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, tool_call_id, created_at)
        VALUES (${event.id}::uuid, ${event.tenantId}::uuid, ${event.userId}::uuid, ${event.sessionId}::uuid,
          ${event.toolName}, ${JSON.stringify(event.args)}::jsonb, ${event.connectorId},
          'pending', ${event.toolCallId}, ${event.createdAt.toISOString()}::timestamptz)
      `
    } catch {
      // Best-effort — don't block gate flow on audit insert failure
    }

    // Cache in Redis + notify
    const pub = await this.getPub()
    const key = `${GATE_KEY_PREFIX}${event.id}`
    await pub.setEx(key, GATE_TTL_SECONDS, JSON.stringify(event))
    await pub.publish('gate:required', JSON.stringify({ gateId: event.id, toolName: event.toolName }))
    return event.id
  }

  async poll(gateId: string): Promise<'approved' | 'rejected' | null> {
    const c = createClient({ url: this.redisUrl })
    try {
      await c.connect()
      const key = `${GATE_KEY_PREFIX}${gateId}:decision`
      const value = await c.get(key)
      if (value === 'approved' || value === 'rejected') return value
      return null
    } catch {
      return null
    } finally {
      await c.disconnect().catch(() => {})
    }
  }

  async record(gateId: string, decision: 'approved' | 'rejected', _decidedBy: string): Promise<void> {
    const pub = await this.getPub()
    const key = `${GATE_KEY_PREFIX}${gateId}:decision`
    await pub.setEx(key, GATE_TTL_SECONDS, decision)
  }
}
