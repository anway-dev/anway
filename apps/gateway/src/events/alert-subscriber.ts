import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { IncidentService } from '../services/incident.js'
import { prisma } from '../db/client.js'
import { UUID_RE } from '../utils/validators.js'
import type { Severity } from '@prisma/client'
import pino from 'pino'

const log = pino({ name: 'alert-subscriber' })

// Severity mapping from alert payload to IncidentSeverity enum
const SEV_MAP: Record<string, Severity> = {
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

  await sub.subscribe('alert_fired', (message) => {
    void (async () => {
      let payload: { tenantId?: string; title?: string; severity?: string; description?: string; service?: string }
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

      const desc = [service, description].filter(Boolean).join(' — ')
      const sev = SEV_MAP[severity ?? ''] ?? 'medium'

      try {
        const incident = await incidentService.create(tenantId, {
          title,
          severity: sev as 'critical' | 'high' | 'medium' | 'low',
          description: desc || undefined,
        })
        log.info({ incidentId: incident.id, tenantId, title }, 'alert-subscriber: incident created from alert')
      } catch (err) {
        log.error({ err, tenantId, title }, 'alert-subscriber: failed to create incident')
      }
    })()
  })

  log.info('AlertSubscriber started — listening on alert_fired')
}
