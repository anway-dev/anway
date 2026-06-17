import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createClient } from 'redis'
import { timingSafeEqual, createHmac } from 'node:crypto'
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

function verifyGitHubSignature(body: Buffer, signature: string, secret: string): boolean {
  try {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch { return false }
}

function verifyDatadogSignature(body: Buffer, signature: string, secret: string): boolean {
  try {
    const expected = createHmac('sha256', secret).update(body).digest('hex')
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch { return false }
}

function verifyWebhookSignatures(request: FastifyRequest): boolean {
  const rawBody: Buffer | undefined = (request as unknown as { rawBodyString?: Buffer }).rawBodyString
  const body = rawBody ?? Buffer.from(JSON.stringify(request.body))
  const ghSecret = process.env['GITHUB_WEBHOOK_SECRET']
  const ddSecret = process.env['DD_WEBHOOK_SECRET']
  const hubSig = request.headers['x-hub-signature-256'] as string | undefined
  const ddSig = request.headers['dd-request-signature'] as string | undefined

  // No secrets configured — nothing to verify (caller authenticated via other means)
  if (!ghSecret && !ddSecret) return true

  if (ghSecret && hubSig) {
    if (!verifyGitHubSignature(body, hubSig, ghSecret)) return false
  }
  if (ddSecret && ddSig) {
    if (!verifyDatadogSignature(body, ddSig, ddSecret)) return false
  }
  return true
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
  // Capture raw request body for webhook HMAC verification (avoids re-serialization discrepancies)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body: Buffer, done) => {
    (_req as unknown as { rawBodyString: Buffer }).rawBodyString = body
    try {
      done(null, JSON.parse(body.toString('utf-8')))
    } catch (err) {
      done(err as Error)
    }
  })

  // Authenticate: static webhook token first, then HMAC, then JWT
  const authenticateEvent = async (request: FastifyRequest, reply: FastifyReply) => {
    // Static webhook token is authentication — no HMAC required on top.
    // Alertmanager, internal connectors use ANVAY_WEBHOOK_TOKEN bearer auth.
    const webhookTenant = webhookTenantFor(request)
    if (webhookTenant) {
      request.user = { sub: 'webhook', tenantId: webhookTenant, role: 'system' } as typeof request.user
      return
    }
    // No static token — verify HMAC for connector webhooks (GitHub/Datadog)
    if (!verifyWebhookSignatures(request)) {
      return reply.code(401).send({ error: 'invalid signature' })
    }
    // Fall through to JWT auth for standard user requests
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
  app.post('/api/events/deploy', {
    preHandler: [authenticateEvent],
    schema: {
      body: {
        type: 'object',
        required: ['service', 'sha'],
        additionalProperties: true,
        properties: {
          service: { type: 'string', minLength: 1, maxLength: 200 },
          sha: { type: 'string', minLength: 1, maxLength: 200 },
          env: { type: 'string', maxLength: 100 },
          version: { type: 'string', maxLength: 200 },
          status: { type: 'string', maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user as { tenantId?: string }
    if (!user.tenantId || !UUID_RE.test(user.tenantId)) { return reply.code(401).send({ error: 'invalid tenant' }) }
    const { tenantId } = user
    const body = request.body as { service: string; sha: string; env?: string; version?: string; status?: string }
    const payload: Record<string, unknown> = {
      type: 'deploy_completed',
      tenantId,
      service: body.service,
      sha: body.sha,
      ...(body.env ? { env: body.env } : {}),
      ...(body.version ? { version: body.version } : {}),
      ...(body.status ? { status: body.status } : {}),
    }
    const pub = await getEventPub()
    await tryPublish(pub, 'deploy_completed', payload)
    return { ok: true }
  })

  // PR merged webhook (Gitea/GitHub)
  app.post('/api/events/pr-merged', {
    preHandler: [authenticateEvent],
    schema: {
      body: {
        type: 'object',
        required: ['repo'],
        additionalProperties: true,
        properties: {
          repo: { type: 'string', minLength: 1, maxLength: 300 },
          prNumber: { type: 'integer', minimum: 1 },
          title: { type: 'string', maxLength: 500 },
          author: { type: 'string', maxLength: 200 },
          sha: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user as { tenantId?: string }
    if (!user.tenantId || !UUID_RE.test(user.tenantId)) { return reply.code(401).send({ error: 'invalid tenant' }) }
    const { tenantId } = user
    const body = request.body as { repo: string; prNumber?: number; title?: string; author?: string; sha?: string }
    const payload: Record<string, unknown> = {
      type: 'pr_merged',
      tenantId,
      repo: body.repo,
      ...(body.prNumber != null ? { prNumber: body.prNumber } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.author ? { author: body.author } : {}),
      ...(body.sha ? { sha: body.sha } : {}),
    }
    const pub = await getEventPub()
    await tryPublish(pub, 'pr_merged', payload)
    return { ok: true }
  })

  // Internal incident event
  app.post('/api/events/incident', {
    preHandler: [authenticateEvent],
    schema: {
      body: {
        type: 'object',
        required: ['title'],
        additionalProperties: true,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          service: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 5000 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user as { tenantId?: string }
    if (!user.tenantId || !UUID_RE.test(user.tenantId)) return reply.code(401).send({ error: 'invalid tenant' })
    const body = request.body as { title: string; severity?: string; service?: string; description?: string }
    const payload: Record<string, unknown> = {
      type: 'incident_created',
      tenantId: user.tenantId,
      title: body.title,
      ...(body.severity ? { severity: body.severity } : {}),
      ...(body.service ? { service: body.service } : {}),
      ...(body.description ? { description: body.description } : {}),
    }
    const pub = await getEventPub()
    await tryPublish(pub, 'incident_created', payload)
    return { ok: true }
  })
}
