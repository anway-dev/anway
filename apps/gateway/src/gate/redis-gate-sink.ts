import { createClient } from 'redis'
import type { IGateSink, GateEvent } from '@anvay/agent'

const GATE_KEY_PREFIX = 'gate:'
const GATE_TTL_SECONDS = 60

/**
 * Redis-backed IGateSink. Gate events stored as Redis strings with 60s TTL.
 *
 * - push: stores event JSON at key `gate:<gateId>`, publishes to `gate:required`
 * - poll: reads key `gate:<gateId>:decision`
 * - record: sets `gate:<gateId>:decision` = "approved" | "rejected"
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
