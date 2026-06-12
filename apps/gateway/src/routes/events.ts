import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createClient } from 'redis'
import { timingSafeEqual } from 'node:crypto'
import pino from 'pino'
import { UUID_RE } from '../utils/validators.js'
import { prisma } from '../db/client.js'
import { IncidentService } from '../services/incident.js'

const log = pino({ name: 'event-routes' })

// Webhook senders (Alertmanager, CI, Gitea) cannot sign tenant JWTs. They
// authenticate with a static bearer token (ANVAY_WEBHOOK_TOKEN) which maps to
// ANVAY_WEBHOOK_TENANT. JWT auth still works on the same routes.
function webhookTenantFor(request: FastifyRequest): string | null {
  const expected = process.env['ANVAY_WEBHOOK_TOKEN']
  if (!expected) return null
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const presented = header.slice('Bearer '.length)
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return process.env['ANVAY_WEBHOOK_TENANT'] ?? '00000000-0000-0000-0000-000000000001'
}

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
  // Accept either the static webhook token or a tenant JWT
  const authenticateEvent = async (request: FastifyRequest, reply: FastifyReply) => {
    const webhookTenant = webhookTenantFor(request)
    if (webhookTenant) {
      request.user = { sub: 'webhook', tenantId: webhookTenant, role: 'system' } as typeof request.user
      return
    }
    return app.authenticate(request, reply)
  }

  // Alertmanager webhook receiver — writes incidents to DB + emits incident_created
  app.post('/api/events/alert', { preHandler: [authenticateEvent] }, async (request, reply) => {
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
    const service = new IncidentService(prisma)

    for (const alert of body.alerts) {
      // Only skip explicitly resolved alerts (status='resolved') — default to firing
      if (alert.status === 'resolved') continue
      const title = alert.labels?.alertname ?? 'Alert Fired'
      const severity = SEVERITY_MAP[alert.labels?.severity ?? ''] ?? 'medium'
      const svc = alert.labels?.service ?? alert.labels?.job ?? null
      const description = alert.annotations?.summary ?? alert.annotations?.description ?? null
      const desc = [svc, description].filter(Boolean).join(' — ') || undefined

      try {
        const incident = await service.create(tenantId, {
          title,
          severity: severity as 'critical' | 'high' | 'medium' | 'low',
          description: desc,
        })
        if (pub) {
          await tryPublish(pub, 'incident_created', {
            type: 'incident_created',
            tenantId,
            incidentId: incident.id,
            title,
            severity,
            serviceHint: svc,
          })
          // Also publish to alert_fired — activates alert-subscriber + trigger engine
          await tryPublish(pub, 'alert_fired', {
            type: 'alert_fired',
            tenantId,
            incidentId: incident.id,
            title,
            severity,
            service: svc,
            description: desc,
          })
        }
      } catch (err) {
        request.log.error({ err, tenantId, title }, 'alert-subscriber: failed to create incident')
      }
    }
    return { ok: true }
  })

  // Deploy event receiver
  app.post('/api/events/deploy', { preHandler: [authenticateEvent] }, async (request, reply) => {
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
  app.post('/api/events/pr-merged', { preHandler: [authenticateEvent] }, async (request, reply) => {
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
  app.post('/api/events/incident', { preHandler: [authenticateEvent] }, async (request, reply) => {
    const user = request.user as { tenantId?: string }
    if (!user.tenantId || !UUID_RE.test(user.tenantId)) return reply.code(401).send({ error: 'invalid tenant' })
    const payload = request.body as Record<string, unknown>
    payload.tenantId = user.tenantId
    const pub = await getEventPub()
    await tryPublish(pub, 'incident_created', payload)
    return { ok: true }
  })
}
