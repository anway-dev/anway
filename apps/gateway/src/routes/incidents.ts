import type { FastifyInstance } from 'fastify'
import { IncidentSeverity, IncidentStatus } from '@prisma/client'
import { IncidentService } from '../services/incident.js'
import { prisma } from '../db/client.js'

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
        },
      },
    },
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { status, severity } = request.query as { status?: IncidentStatus; severity?: IncidentSeverity }
    return service.list(tenantId, { status, severity })
  })

  app.get<{ Params: { id: string } }>('/api/incidents/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    const incident = await service.get(id, tenantId)
    if (!incident) { reply.code(404); return { error: 'Incident not found' } }
    return incident
  })

  app.post<{ Body: { title: string; severity: IncidentSeverity; description?: string } }>('/api/incidents', {
    preHandler: [app.authenticate],
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
    const { tenantId } = request.user as { tenantId: string }
    const { title, severity, description } = request.body
    return service.create(tenantId, { title, severity, description })
  })

  app.patch<{ Params: { id: string }; Body: { status?: IncidentStatus } }>('/api/incidents/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    const updates = request.body
    const result = await service.update(id, tenantId, updates)
    if (result.count === 0) { reply.code(404); return { error: 'Incident not found' } }
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/incidents/:id/resolve', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    const result = await service.resolve(id, tenantId)
    if (result.count === 0) { reply.code(404); return { error: 'Incident not found' } }
    return { ok: true }
  })
}
