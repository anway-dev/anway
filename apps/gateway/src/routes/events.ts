import type { FastifyInstance } from 'fastify'
import { createClient } from 'redis'
import pino from 'pino'
import { UUID_RE } from '../utils/validators.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

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

// Map alertmanager severity to IncidentSeverity enum
const SEVERITY_MAP: Record<string, string> = {
  critical: 'critical', high: 'high', warning: 'medium', low: 'low',
}

export async function eventRoutes(app: FastifyInstance) {

  // Alertmanager webhook receiver — writes incidents to DB + emits incident_created
  app.post('/api/events/alert', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as {
      alerts?: Array<{
        labels?: { alertname?: string; severity?: string; service?: string; job?: string }
        status?: string
        annotations?: { summary?: string; description?: string }
      }>
    }

    if (!body.alerts || !Array.isArray(body.alerts)) return { ok: true }

    const user = request.user as { tenantId?: string }
    if (!user.tenantId || !UUID_RE.test(user.tenantId)) { return reply.code(401).send({ error: 'invalid tenant' }) }
    const { tenantId } = user
    const pub = await getEventPub()

    for (const alert of body.alerts) {
      if (alert.status !== 'firing') continue
      const title = alert.labels?.alertname ?? 'Alert Fired'
      const severity = alert.labels?.severity ?? 'high'
      const service = alert.labels?.service ?? alert.labels?.job ?? null
      const description = alert.annotations?.summary ?? alert.annotations?.description ?? null

      // Write incident to DB — this is what the War Room reads
      const mappedSeverity = SEVERITY_MAP[severity] ?? 'medium'
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO incidents (id, tenant_id, title, severity, status, description, suggested_root_cause, created_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${title}, ${mappedSeverity}::incident_severity,
                  'active', ${description}, ${service ? `Possible root cause: ${service} service` : null},
                  NOW())
          ON CONFLICT DO NOTHING
          RETURNING id
        `
      ).catch(() => [])

      const incidentId = (rows as Array<{ id: string }>)[0]?.id
      if (incidentId && pub) {
        await tryPublish(pub, 'incident_created', {
          type: 'incident_created',
          tenantId,
          incidentId,
          title,
          severity,
          serviceHint: service,
        })
      }
    }
    return { ok: true }
  })

  // Deploy event receiver
  app.post('/api/events/deploy', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user as { tenantId?: string }
    if (!user.tenantId || !UUID_RE.test(user.tenantId)) { return reply.code(401).send({ error: 'invalid tenant' }) }
    const { tenantId } = user
    const payload = request.body as Record<string, unknown>
    payload.tenantId = tenantId
    const pub = await getEventPub()
    await tryPublish(pub, 'deploy_completed', payload)
    return { ok: true }
  })

  // PR merged webhook (Gitea/GitHub)
  app.post('/api/events/pr-merged', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user as { tenantId?: string }
    if (!user.tenantId || !UUID_RE.test(user.tenantId)) { return reply.code(401).send({ error: 'invalid tenant' }) }
    const { tenantId } = user
    const payload = request.body as Record<string, unknown>
    payload.tenantId = tenantId
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
