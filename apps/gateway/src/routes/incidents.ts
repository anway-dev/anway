import type { FastifyInstance } from 'fastify'
import { IncidentSeverity, IncidentStatus } from '@prisma/client'
import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { TenantId, UserId, SessionId } from '@anvay/types'
import { IncidentService } from '../services/incident.js'
import { PostgresAuditSink } from '../audit/postgres-sink.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'
import { appendAuditEvent } from './audit.js'
import { UUID_RE } from '../utils/validators.js'

let _pub: RedisClientType | null = null

async function getPub(): Promise<RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (!_pub) {
    _pub = createClient({ url }) as RedisClientType
    await _pub.connect()
  }
  return _pub
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
    const { tenantId } = request.user as { tenantId: string }
    const { status, severity, cursor, limit: limitStr } = request.query as { status?: IncidentStatus; severity?: IncidentSeverity; cursor?: string; limit?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)
    return service.list(tenantId, { status, severity, cursor, limit })
  })

  app.get<{ Params: { id: string } }>('/api/incidents/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    const incident = await service.get(id, tenantId)
    if (!incident) { reply.code(404); return { error: 'Incident not found' } }
    return incident
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
    const user = request.user as { tenantId: string; sub: string }
    const { title, severity, description } = request.body
    const incident = await service.create(user.tenantId, { title, severity, description })

    // Emit incident_created for graph builder + SRE subscriber (best-effort)
    try {
      const pub = await getPub()
      if (pub) {
        await pub.publish('incident_created', JSON.stringify({
          type: 'incident_created',
          tenantId: user.tenantId,
          incidentId: incident.id,
          title: incident.title,
          severity: incident.severity,
          description: incident.description ?? undefined,
        }))
      }
    } catch (err) {
      request.log.warn({ err }, 'incident_created Redis publish failed')
    }

    // Audit log (best-effort — must not block response)
    const audit = new PostgresAuditSink(prisma, (err) => request.log.error({ err }, 'incident audit write failed'))
    void audit.append({
      id: crypto.randomUUID(),
      tenantId: TenantId(user.tenantId),
      userId: UserId(user.sub),
      sessionId: SessionId(''),
      eventType: 'incident_created',
      payload: { incidentId: incident.id, title, severity },
      createdAt: new Date(),
    })

    return incident
  })

  app.patch<{ Params: { id: string }; Body: { status?: IncidentStatus } }>('/api/incidents/:id', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
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
}
