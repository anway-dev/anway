import { createClient } from 'redis'
import { TriggerEngine } from './engine.js'
import type { TriggerRule } from './engine.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import pino from 'pino'

const log = pino({ name: 'trigger-subscriber' })
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EVENT_CHANNELS = [
  'alert_fired', 'deploy_completed', 'deploy_failed',
  'error_rate_threshold', 'pr_merged', 'test_failed',
  'incident_created', 'cloud_finding',
]

export async function startTriggerSubscriber(redisUrl: string): Promise<void> {
  const sub = createClient({ url: redisUrl })
  const pub = createClient({ url: redisUrl })
  await Promise.all([sub.connect(), pub.connect()])

  for (const channel of EVENT_CHANNELS) {
    await sub.subscribe(channel, async (message) => {
      let payload: { tenantId: string; [k: string]: unknown }
      try {
        payload = JSON.parse(message)
      } catch {
        return
      }
      // Validate tenantId before passing to DB
      if (typeof payload.tenantId !== 'string' || !UUID_RE.test(payload.tenantId)) {
        log.warn({ channel, tenantId: payload.tenantId }, 'subscriber: invalid tenantId — skipping')
        return
      }
      const { tenantId, ...rest } = payload
      const rules = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<TriggerRule[]>`
          SELECT id, tenant_id AS "tenantId", event_type AS "eventType",
                 condition, actions, enabled
          FROM trigger_rules
          WHERE tenant_id = ${tenantId}::uuid AND enabled = true
        `
      )
      const engine = new TriggerEngine()
      engine.loadRules(rules)
      const actions = await engine.evaluate(channel, rest)

      if (actions.length > 0) {
        await pub.publish('trigger_matched', JSON.stringify({ tenantId, channel, actions }))
      }
    })
  }
}
