import type { FastifyInstance } from 'fastify'
import { createClient } from 'redis'

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
        const payload = {
          tenantId: body.tenantId ?? DEMO_TENANT,
          title: alert.labels?.alertname ?? 'Alert Fired',
          severity: alert.labels?.severity ?? 'high',
          service: alert.labels?.service ?? alert.labels?.job,
          description: alert.annotations?.summary ?? alert.annotations?.description,
        }
        await pub.publish('alert_fired', JSON.stringify(payload))
      }
    } else {
      await pub.publish('alert_fired', JSON.stringify(body))
    }
    return { ok: true }
  })

  // Deploy event receiver
  app.post('/api/events/deploy', async (request) => {
    const payload = request.body as Record<string, unknown>
    const pub = await getEventPub()
    if (pub) await pub.publish('deploy_completed', JSON.stringify(payload))
    return { ok: true }
  })

  // PR merged webhook (Gitea/GitHub)
  app.post('/api/events/pr-merged', async (request) => {
    const payload = request.body as Record<string, unknown>
    const pub = await getEventPub()
    if (pub) await pub.publish('pr_merged', JSON.stringify(payload))
    return { ok: true }
  })

  // Internal incident event
  app.post('/api/events/incident', { preHandler: [app.authenticate] }, async (request) => {
    const payload = request.body as Record<string, unknown>
    const pub = await getEventPub()
    if (pub) await pub.publish('incident_created', JSON.stringify(payload))
    return { ok: true }
  })
}

let _pub: import('redis').RedisClientType | null = null

async function getEventPub(): Promise<import('redis').RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (!_pub) {
    _pub = createClient({ url }) as import('redis').RedisClientType
    await _pub.connect()
  }
  return _pub
}
