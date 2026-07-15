import type { FastifyInstance } from 'fastify'
import { IncidentSeverity, IncidentStatus } from '@prisma/client'
import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { TenantId, UserId, SessionId } from '@anway/types'
import { IncidentService } from '../services/incident.js'
import { RecallService } from '../services/recall.js'
import { TimelineService } from '../services/timeline.js'
import { PostgresAuditSink } from '../audit/postgres-sink.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { resolveEnvId } from '../utils/env-scope.js'
import { requireRole } from '../plugins/rbac.js'
import { appendAuditEvent } from './audit.js'
import { UUID_RE } from '../utils/validators.js'
import { publishDurable } from '../events/durable-events.js'

let _pub: RedisClientType | null = null
let _pubConnecting: Promise<RedisClientType | null> | null = null

async function getPub(): Promise<RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (_pub) return _pub
  if (_pubConnecting) return _pubConnecting
  _pubConnecting = (async () => {
    const client = createClient({ url, socket: { reconnectStrategy: (r) => Math.min(r * 100, 3000) } }) as RedisClientType
    client.on('error', () => {})
    await client.connect()
    _pub = client
    return client
  })().catch(() => { _pubConnecting = null; return null })
  return _pubConnecting
}

export async function incidentRoutes(app: FastifyInstance) {
  const service = new IncidentService(prisma)

  app.get('/api/incidents', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          severity: { type: 'string' },
          cursor: { type: 'string' },
          limit: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, env } = request.user as { tenantId: string; env?: string }
    const { status, severity, cursor, limit: limitStr } = request.query as { status?: IncidentStatus; severity?: IncidentSeverity; cursor?: string; limit?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)
    const envId = await resolveEnvId(prisma, tenantId, env)
    return service.list(tenantId, { status, severity, cursor, limit, envId })
  })

  app.get<{ Params: { id: string } }>('/api/incidents/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    const incident = await service.get(id, tenantId)
    if (!incident) { reply.code(404); return { error: 'Incident not found' } }
    // Recall: attach prior-resolution memory for this signal's fingerprint, so
    // the War Room can show "seen N× before" + offer the prior fix (gated).
    const recall = await new RecallService(prisma).forIncident(tenantId, id).catch(() => null)
    // `service` lives in a raw-added column not on the Prisma model — surface it
    // so the War Room can scope the change timeline to the affected service.
    const svcRow = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ service: string | null }>>`
        SELECT service FROM incidents WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
    ).catch(() => [] as Array<{ service: string | null }>)
    return { ...incident, service: svcRow[0]?.service ?? null, recall }
  })

  // Change Timeline — "what changed before X broke?". Read-only, tenant-scoped.
  app.get('/api/timeline', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          hoursBack: { type: 'string' },
          before: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { service, hoursBack, before } = request.query as { service?: string; hoursBack?: string; before?: string }
    const to = before ? new Date(before) : new Date()
    const hours = Math.min(Math.max(parseFloat(hoursBack ?? '24') || 24, 0.1), 720)
    const from = new Date(to.getTime() - hours * 3600 * 1000)
    const events = await new TimelineService(prisma).getTimeline(tenantId, { from, to, service, limit: 200 })
    return { window: { from: from.toISOString(), to: to.toISOString() }, service: service ?? null, count: events.length, events }
  })

  app.post<{ Body: { title: string; severity: IncidentSeverity; description?: string } }>('/api/incidents', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
    schema: {
      body: {
        type: 'object',
        required: ['title', 'severity'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const user = request.user as { tenantId: string; sub: string; env?: string }
    const { title, severity, description } = request.body
    const envId = await resolveEnvId(prisma, user.tenantId, user.env)
    const incident = await service.create(user.tenantId, { title, severity, description, envId })

    // Emit incident_created for graph builder + SRE subscriber (best-effort)
    try {
      const pub = await getPub()
      if (pub) {
        await publishDurable(pub, user.tenantId, 'incident_created', {
          type: 'incident_created',
          tenantId: user.tenantId,
          incidentId: incident.id,
          title: incident.title,
          severity: incident.severity,
          description: incident.description ?? undefined,
        })
      }
    } catch (err) {
      request.log.warn({ err }, 'incident_created Redis publish failed')
    }

    // Audit log (best-effort — must not block response)
    const audit = new PostgresAuditSink(prisma, (err) => request.log.error({ err }, 'incident audit write failed'))
    await audit.append({
      id: crypto.randomUUID(),
      tenantId: TenantId(user.tenantId),
      userId: UserId(user.sub),
      sessionId: SessionId(''),
      eventType: 'incident_created',
      payload: { incidentId: incident.id, title, severity },
      createdAt: new Date(),
    }).catch((err) => request.log.error({ err }, 'incident_created audit append failed'))

    return incident
  })

  app.patch<{ Params: { id: string }; Body: { status?: IncidentStatus; title?: string; severity?: string; description?: string } }>('/api/incidents/:id', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['active', 'investigating', 'identified', 'monitoring'] },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user as { tenantId: string; sub: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    const updates = request.body
    const result = await service.update(id, user.tenantId, updates)
    if (result.count === 0) { reply.code(404); return { error: 'Incident not found' } }

    const audit = new PostgresAuditSink(prisma, (err) => request.log.error({ err }, 'incident audit write failed'))
    void audit.append({
      id: crypto.randomUUID(),
      tenantId: TenantId(user.tenantId),
      userId: UserId(user.sub),
      sessionId: SessionId(''),
      eventType: 'incident_updated',
      payload: { incidentId: id, updates },
      createdAt: new Date(),
    })

    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/incidents/:id/resolve', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
  }, async (request, reply) => {
    const user = request.user as { tenantId: string; sub: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    const result = await service.resolve(id, user.tenantId)
    if (result.count === 0) { reply.code(404); return { error: 'Incident not found' } }

    // Recall: capture this resolution so the next incident of its kind can be
    // triaged against it. Best-effort — never block the resolve on it.
    void new RecallService(prisma).recordResolution(user.tenantId, id)
      .catch((err) => request.log.warn({ err, incidentId: id }, 'recall: recordResolution failed'))

    const audit = new PostgresAuditSink(prisma, (err) => request.log.error({ err }, 'incident audit write failed'))
    void audit.append({
      id: crypto.randomUUID(),
      tenantId: TenantId(user.tenantId),
      userId: UserId(user.sub),
      sessionId: SessionId(''),
      eventType: 'incident_resolved',
      payload: { incidentId: id },
      createdAt: new Date(),
    })

    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>(
    '/api/incidents/:id',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { id } = request.params
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          DELETE FROM incidents WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid RETURNING id
        `
      ).catch(() => [] as Array<{ id: string }>)
      if (rows.length === 0) return reply.code(404).send({ error: 'not found' })
      await appendAuditEvent({
        tenantId, userId,
        action: 'incident.delete',
        resource: `incident:${id}`,
        outcome: 'action_executed',
        metadata: { id },
      }).catch(() => {})
      return reply.send({ deleted: true, id })
    },
  )

  app.delete<{ Body: { pattern: string } }>(
    '/api/incidents/bulk',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { pattern } = (request.body ?? {}) as { pattern?: string }
      if (!pattern) return reply.code(400).send({ error: 'pattern required' })
      const deleted = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`DELETE FROM incidents WHERE tenant_id = ${tenantId}::uuid AND title ILIKE ${`%${pattern}%`}`
      )
      await appendAuditEvent({
        tenantId, userId,
        action: 'incident.bulk_delete',
        resource: `incident:bulk:${pattern}`,
        outcome: 'action_executed',
        metadata: { pattern, deleted: Number(deleted) },
      }).catch(() => {})
      return reply.send({ deleted: Number(deleted), pattern })
    },
  )
}
