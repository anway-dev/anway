import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { IncidentService } from '../services/incident.js'
import { prisma } from '../db/client.js'
import { UUID_RE } from '../utils/validators.js'
import type { IncidentSeverity } from '@prisma/client'
import pino from 'pino'
import { publishDurable, claimEvent } from './durable-events.js'

const log = pino({ name: 'alert-subscriber' })

// Severity mapping from alert payload to IncidentSeverity enum
const SEV_MAP: Record<string, IncidentSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
}

export async function startAlertSubscriber(redisUrl: string): Promise<void> {
  const sub: RedisClientType = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
    },
  }) as RedisClientType

  sub.on('error', (err) => log.error({ err }, 'AlertSubscriber Redis error'))
  await sub.connect()

  const incidentService = new IncidentService(prisma)

  // Publisher for incident_created — notifies incident-subscriber so SRE analysis runs
  const pub: RedisClientType = createClient({
    url: redisUrl,
    socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
  }) as RedisClientType
  pub.on('error', (err) => log.error({ err }, 'AlertSubscriber pub Redis error'))
  await pub.connect()

  await sub.subscribe('alert_fired', (message) => {
    void (async () => {
      let payload: { tenantId?: string; title?: string; severity?: string; description?: string; service?: string; incidentId?: string; __eventLogId?: string }
      try {
        payload = JSON.parse(message)
      } catch {
        return
      }

      const { tenantId, title, severity, description, service } = payload

      if (
        typeof tenantId !== 'string' || !UUID_RE.test(tenantId) ||
        typeof title !== 'string'
      ) {
        log.warn({ payload }, 'alert-subscriber: invalid payload — skipping')
        return
      }

      // Cross-replica dedupe: with >1 gateway replica, every replica gets
      // this pub/sub message — exactly one claims it (durable-events.ts).
      // Claim BEFORE the incidentId early-return below: that return is this
      // consumer's deliberate, complete handling of a webhook-originated
      // alert (the route already wrote the incident) — confirmed live via
      // the first real E2E run of the outbox that skipping the claim there
      // left the expected 'alert-subscriber' consumption row missing, so
      // the replayer re-published every webhook alert up to MAX_REPLAYS
      // times for nothing.
      if (!(await claimEvent(payload.__eventLogId, tenantId, 'alert-subscriber'))) return

      // Webhook route already wrote the incident and stamped its id on the
      // event — creating again here duplicates every alert.
      if (payload.incidentId) return

      const desc = [service, description].filter(Boolean).join(' — ')
      const sev = SEV_MAP[severity ?? ''] ?? 'medium'

      try {
        const incident = await incidentService.create(tenantId, {
          title,
          severity: sev as 'critical' | 'high' | 'medium' | 'low',
          description: desc || undefined,
        })
        log.info({ incidentId: incident.id, tenantId, title }, 'alert-subscriber: incident created from alert')
        // Publish incident_created so incident-subscriber runs SRE analysis
        await publishDurable(pub, tenantId, 'incident_created', {
          type: 'incident_created',
          tenantId,
          incidentId: incident.id,
          title,
          description: desc || undefined,
          // Explicit service label from the alert — feeds the CAUSED_BY
          // deploy correlation without title-matching heuristics.
          ...(service ? { serviceHint: service } : {}),
        }).catch((err) => log.error({ err }, 'alert-subscriber: incident_created publish failed'))
      } catch (err) {
        log.error({ err, tenantId, title }, 'alert-subscriber: failed to create incident')
      }
    })()
  })

  log.info('AlertSubscriber started — listening on alert_fired')
}
