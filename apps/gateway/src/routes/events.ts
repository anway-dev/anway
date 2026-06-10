import type { FastifyInstance } from 'fastify'
import { createClient } from 'redis'
import pino from 'pino'

const log = pino({ name: 'event-routes' })

let _pub: import('redis').RedisClientType | null = null

async function getEventPub(): Promise<import('redis').RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (!_pub) {
    _pub = createClient({
      url,
      socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
    }) as import('redis').RedisClientType
    _pub.on('error', (err) => log.error({ err }, 'EventPub Redis error'))
    await _pub.connect()
  }
  return _pub
}

async function tryPublish(pub: import('redis').RedisClientType | null, channel: string, payload: Record<string, unknown>): Promise<void> {
  if (!pub) return
  try {
    await pub.publish(channel, JSON.stringify(payload))
  } catch (err) {
    log.error({ err, channel }, 'Redis publish failed')
  }
}

export async function eventRoutes(app: FastifyInstance) {
  const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'

  // Alertmanager webhook receiver
  app.post('/api/events/alert', async (request) => {
    const body = request.body as {
      alerts?: Array<{
        labels?: { alertname?: string; severity?: string; service?: string; job?: string }
        status?: string
        annotations?: { summary?: string; description?: string }
      }>
      tenantId?: string
    }
    const pub = await getEventPub()
    if (!pub) return { ok: true }

    if (body.alerts && Array.isArray(body.alerts)) {
      for (const alert of body.alerts) {
        if (alert.status !== 'firing') continue
        await tryPublish(pub, 'alert_fired', {
          tenantId: body.tenantId ?? DEMO_TENANT,
          title: alert.labels?.alertname ?? 'Alert Fired',
          severity: alert.labels?.severity ?? 'high',
          service: alert.labels?.service ?? alert.labels?.job,
          description: alert.annotations?.summary ?? alert.annotations?.description,
        })
      }
    } else {
      await tryPublish(pub, 'alert_fired', body as Record<string, unknown>)
    }
    return { ok: true }
  })

  // Deploy event receiver
  app.post('/api/events/deploy', async (request) => {
    const payload = request.body as Record<string, unknown>
    const pub = await getEventPub()
    await tryPublish(pub, 'deploy_completed', payload)
    return { ok: true }
  })

  // PR merged webhook (Gitea/GitHub)
  app.post('/api/events/pr-merged', async (request) => {
    const payload = request.body as Record<string, unknown>
    const pub = await getEventPub()
    await tryPublish(pub, 'pr_merged', payload)
    return { ok: true }
  })

  // Internal incident event
  app.post('/api/events/incident', { preHandler: [app.authenticate] }, async (request) => {
    const payload = request.body as Record<string, unknown>
    const pub = await getEventPub()
    await tryPublish(pub, 'incident_created', payload)
    return { ok: true }
  })
}
