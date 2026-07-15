import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createClient } from 'redis'
import { timingSafeEqual, createHmac } from 'node:crypto'
import pino from 'pino'
import { UUID_RE } from '../utils/validators.js'
import { prisma } from '../db/client.js'
import { decryptJson } from '../utils/crypto.js'
import { IncidentService } from '../services/incident.js'
import { resolveEnvId } from '../utils/env-scope.js'
import { publishDurable } from '../events/durable-events.js'
import { registerGithubWebhookRoute } from './github-webhook.js'
import { stampEventReceivedByType } from '../events/webhook-registrar.js'

const log = pino({ name: 'event-routes' })

/**
 * Resolve the tenant for an inbound webhook alert.
 * Priority:
 *   1. Static ANWAY_WEBHOOK_TOKEN env var (backward compat, maps to ANWAY_WEBHOOK_TENANT)
 *   2. Per-tenant alertmanager connector_config.credentials_enc.webhookToken
 */
async function webhookTenantFor(request: FastifyRequest): Promise<string | null> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const presented = header.slice('Bearer '.length)

  // 1. Static env var (backward compat)
  const expected = process.env['ANWAY_WEBHOOK_TOKEN']
  if (expected) {
    const a = Buffer.from(presented)
    const b = Buffer.from(expected)
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return process.env['ANWAY_WEBHOOK_TENANT'] ?? '00000000-0000-0000-0000-000000000001'
    }
  }

  // 2. Per-tenant alertmanager connector config
  try {
    const rows = await prisma.$queryRaw<Array<{ tenant_id: string; credentials_enc: string }>>`
      SELECT tenant_id::text, credentials_enc FROM connector_config
      WHERE connector_type = 'alertmanager' AND enabled = true AND credentials_enc IS NOT NULL
    `
    for (const row of rows) {
      try {
        const creds = decryptJson<Record<string, unknown>>(row.credentials_enc)
        const token = creds['webhookToken'] as string | undefined
        if (!token) continue
        const a = Buffer.from(presented)
        const b = Buffer.from(token)
        if (a.length === b.length && timingSafeEqual(a, b)) {
          return row.tenant_id
        }
      } catch { continue }
    }
  } catch { /* ignore DB errors */ }

  return null
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

type SignatureCheck = 'unconfigured' | 'no-signature' | 'valid' | 'invalid'

// Previously returned a plain boolean, which collapsed "no secret configured"
// and "signature header present and genuinely valid" into the same `true` —
// confirmed live via independent review that this made HMAC auth dead code:
// authenticateEvent always fell through to app.authenticate() (JWT) after a
// `true` result, but a real GitHub/Datadog webhook sender never carries a
// JWT, so a correctly-signed webhook could reject a forged signature but
// could never itself succeed end-to-end. Returning a distinguishable
// 'valid' result lets the caller actually authenticate the request instead
// of always deferring to a JWT check that such senders can never satisfy.
function verifyWebhookSignatures(request: FastifyRequest): SignatureCheck {
  const rawBody: Buffer | undefined = (request as unknown as { rawBodyString?: Buffer }).rawBodyString
  const body = rawBody ?? Buffer.from(JSON.stringify(request.body))
  const ghSecret = process.env['GITHUB_WEBHOOK_SECRET']
  const ddSecret = process.env['DD_WEBHOOK_SECRET']
  const hubSig = request.headers['x-hub-signature-256'] as string | undefined
  const ddSig = request.headers['dd-request-signature'] as string | undefined

  // No secrets configured — nothing to verify (caller authenticated via other means)
  if (!ghSecret && !ddSecret) return 'unconfigured'

  if (ghSecret && hubSig) {
    return verifyGitHubSignature(body, hubSig, ghSecret) ? 'valid' : 'invalid'
  }
  if (ddSecret && ddSig) {
    return verifyDatadogSignature(body, ddSig, ddSecret) ? 'valid' : 'invalid'
  }
  // Secret(s) configured but no matching signature header on this request —
  // not necessarily an attack (e.g. a real logged-in user hitting the same
  // route with a JWT), so defer to JWT auth rather than rejecting outright.
  return 'no-signature'
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

// Durable publish (outbox) — replaces the old fire-and-forget Redis-only
// publish; see events/durable-events.ts for the loss/dedupe rationale.
// Every payload on these routes already carries tenantId; the outbox row
// is written under that tenant's RLS scope.
async function tryPublish(pub: import('redis').RedisClientType | null, channel: string, payload: Record<string, unknown>): Promise<void> {
  const tenantId = typeof payload['tenantId'] === 'string' ? payload['tenantId'] : null
  if (!tenantId) {
    // No tenant — can't write an outbox row; degrade to ephemeral publish.
    if (!pub) return
    try { await pub.publish(channel, JSON.stringify(payload)) } catch (err) { log.error({ err, channel }, 'Redis publish failed') }
    return
  }
  await publishDurable(pub, tenantId, channel, payload)
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

  // Native GitHub webhook receiver — needs this plugin scope's raw-body
  // capture for HMAC verification. See github-webhook.ts.
  registerGithubWebhookRoute(app, getEventPub)

  // Authenticate: static webhook token first, then HMAC, then JWT
  const authenticateEvent = async (request: FastifyRequest, reply: FastifyReply) => {
    // Static webhook token / per-tenant alertmanager token — no HMAC required on top.
    const webhookTenant = await webhookTenantFor(request)
    if (webhookTenant) {
      request.user = { sub: 'webhook', tenantId: webhookTenant, role: 'system' } as typeof request.user
      return
    }
    // HMAC for connector webhooks (GitHub/Datadog) — a genuinely invalid
    // signature is rejected immediately; a genuinely valid one authenticates
    // the request directly (these senders never carry a JWT, so falling
    // through to app.authenticate would 401 every real webhook — see
    // verifyWebhookSignatures' comment for the bug this replaced).
    const sig = verifyWebhookSignatures(request)
    if (sig === 'invalid') {
      return reply.code(401).send({ error: 'invalid signature' })
    }
    if (sig === 'valid') {
      const tenantId = process.env['ANWAY_WEBHOOK_TENANT'] ?? '00000000-0000-0000-0000-000000000001'
      request.user = { sub: 'webhook', tenantId, role: 'system' } as typeof request.user
      return
    }
    // 'unconfigured' or 'no-signature' — fall through to JWT auth for standard user requests
    return app.authenticate(request, reply)
  }

  // Alertmanager webhook receiver — writes incidents to DB + emits incident_created
  app.post('/api/events/alert', { preHandler: [authenticateEvent] }, async (request, reply) => {
    const body = request.body as {
      alerts?: Array<{
        labels?: { alertname?: string; severity?: string; service?: string; job?: string; environment?: string; env?: string; namespace?: string }
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

    // Event-silence visibility: stamp the alertmanager connector as having
    // delivered a real event (webhook-registrar.ts).
    await stampEventReceivedByType(tenantId, 'alertmanager')

    for (const alert of body.alerts) {
      // Only skip explicitly resolved alerts (status='resolved') — default to firing
      if (alert.status === 'resolved') continue
      const title = alert.labels?.alertname ?? 'Alert Fired'
      const severity = SEVERITY_MAP[alert.labels?.severity ?? ''] ?? 'medium'
      const svc = alert.labels?.service ?? alert.labels?.job ?? null
      const description = alert.annotations?.summary ?? alert.annotations?.description ?? null
      const desc = [svc, description].filter(Boolean).join(' — ') || undefined
      // Environment scoping: an alert that declares its environment
      // (environment/env/namespace label) produces an incident pinned to
      // that env, so the env switcher segregates real per-env alerts. An
      // alert with NO such label stays global (env_id NULL, shows in every
      // env) — honest: we don't invent an environment the alert never
      // declared.
      const envLabel = alert.labels?.environment ?? alert.labels?.env ?? alert.labels?.namespace
      const alertEnvId = await resolveEnvId(prisma, tenantId, envLabel)

      try {
        const incident = await service.create(tenantId, {
          title,
          severity: severity as 'critical' | 'high' | 'medium' | 'low',
          description: desc,
          envId: alertEnvId,
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

  // ── Live incident stream (SSE) ──────────────────────────────────────────
  // The War Room subscribes here to get incident changes pushed in real time
  // instead of only on page load. On any incident/alert event for THIS tenant
  // we emit a lightweight "incidents_changed" signal; the client re-fetches
  // /api/incidents (so it applies its own env filter). Tenant isolation is
  // enforced by matching payload.tenantId to the authenticated user's tenant.
  app.get('/api/events/stream', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }

    // Take over the raw response — we stream SSE frames manually and keep the
    // socket open until the client disconnects, so Fastify must not try to
    // send/serialise its own reply.
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    raw.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)

    // keep-alive comment ping so proxies/browsers don't drop an idle stream
    const heartbeat = setInterval(() => { try { raw.write(': ping\n\n') } catch { /* closed */ } }, 25_000)

    const CHANNELS = ['incident_created', 'incident_updated', 'incident_resolved', 'alert_fired']
    const redisUrl = process.env['REDIS_URL']
    let sub: import('redis').RedisClientType | null = null

    const cleanup = async () => {
      clearInterval(heartbeat)
      if (sub) { try { await sub.quit() } catch { /* ignore */ } sub = null }
    }
    raw.on('close', () => { void cleanup() })

    if (redisUrl) {
      try {
        sub = createClient({ url: redisUrl }) as import('redis').RedisClientType
        await sub.connect()
        const onMsg = (message: string) => {
          try {
            const payload = JSON.parse(message) as { tenantId?: string }
            if (payload.tenantId && payload.tenantId !== tenantId) return  // tenant isolation
            raw.write(`data: ${JSON.stringify({ type: 'incidents_changed' })}\n\n`)
          } catch { /* ignore malformed */ }
        }
        for (const ch of CHANNELS) await sub.subscribe(ch, onMsg)
      } catch (err) {
        request.log.warn({ err }, 'incident stream: Redis subscribe failed — heartbeat-only')
        await cleanup().catch(() => {})
      }
    }
    // hijacked — connection stays open until the client closes (see raw.on close)
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
