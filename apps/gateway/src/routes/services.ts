import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'
import { appendAuditEvent } from './audit.js'

interface EntityRow {
  id: string
  name: string
  type: string
  metadata: Record<string, unknown>
}

interface RelRow {
  fromEntityId: string
  relType: string
  toEntityId: string
}

interface IncidentRow {
  title: string
  status: string
  suggested_root_cause: string | null
}

function sanitizeText(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

export async function serviceRoutes(app: FastifyInstance) {
  app.post<{ Body: { repoUrl?: string; name?: string } }>(
    '/api/services',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { repoUrl, name } = request.body
      if (!repoUrl && !name) return reply.code(400).send({ error: 'repoUrl or name required' })
      const serviceName = sanitizeText(name ??
        (repoUrl!.split('/').pop() ?? 'unknown').replace(/\.git$/, ''))
      const meta = JSON.stringify({ repoUrl: repoUrl ?? null, source: 'manual' })
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO entities (id, tenant_id, type, name, metadata)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, 'Service', ${serviceName}, ${meta}::jsonb)
          ON CONFLICT (tenant_id, type, name) DO UPDATE SET metadata = EXCLUDED.metadata
          RETURNING id
        `
      ).catch(() => [])
      if (rows.length === 0) return reply.code(500).send({ error: 'create failed' })
      const newId = (rows as Array<{ id: string }>)[0]!.id
      await appendAuditEvent({
        tenantId, userId,
        action: 'service.create',
        resource: `service:${newId}`,
        outcome: 'action_executed',
        metadata: { name: serviceName },
      }).catch(() => {})
      return reply.code(201).send({ id: newId, name: serviceName })
    },
  )

  app.get('/api/services', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { cursor, limit: limitStr } = request.query as { cursor?: string; limit?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)

    return withTenant(prisma, tenantId, async (tx) => {
      const entities = await tx.$queryRaw<EntityRow[]>`
        SELECT id, name, type, metadata FROM entities
        WHERE type = 'Service'
        ${cursor ? Prisma.sql`AND id > ${cursor}::uuid` : Prisma.sql``}
        ORDER BY id ASC
        LIMIT ${limit + 1}
      `
      if (entities.length === 0) return { data: [], nextCursor: null }

      const hasMore = entities.length > limit
      const data = hasMore ? entities.slice(0, limit) : entities

      const allEntities = await tx.$queryRaw<EntityRow[]>`
        SELECT id, name, type, metadata FROM entities LIMIT 1000
      `
      const allRels = await tx.$queryRaw<RelRow[]>`
        SELECT from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId"
        FROM relationships LIMIT 2000
      `
      const activeIncidents = await tx.$queryRaw<IncidentRow[]>`
        SELECT title, status, suggested_root_cause FROM incidents WHERE status IN ('active', 'investigating') ORDER BY created_at DESC LIMIT 100
      `

      const entityById = new Map(allEntities.map(e => [e.id, e]))

      // Pre-build relationship lookup Maps — eliminates O(N×M) find/filter per service
      const relsByFrom = new Map<string, typeof allRels>()
      const relsByTo = new Map<string, typeof allRels>()
      for (const r of allRels) {
        if (!relsByFrom.has(r.fromEntityId)) relsByFrom.set(r.fromEntityId, [])
        relsByFrom.get(r.fromEntityId)!.push(r)
        if (!relsByTo.has(r.toEntityId)) relsByTo.set(r.toEntityId, [])
        relsByTo.get(r.toEntityId)!.push(r)
      }

      const result = data.map(entity => {
        const meta = (entity.metadata ?? {}) as Record<string, unknown>
        const fromRels = relsByFrom.get(entity.id) ?? []
        const toRels = relsByTo.get(entity.id) ?? []

        const ownedByRel = fromRels.find(r => r.relType === 'OWNED_BY')
        const hostedInRel = fromRels.find(r => r.relType === 'HOSTED_IN')
        const depRels = fromRels.filter(r => r.relType === 'DEPENDS_ON')
        const callerRels = toRels.filter(r => r.relType === 'DEPENDS_ON')

        const teamEntity = ownedByRel ? entityById.get(ownedByRel.toEntityId) : undefined
        const repoEntity = hostedInRel ? entityById.get(hostedInRel.toEntityId) : undefined
        const repoMeta = (repoEntity?.metadata ?? {}) as Record<string, unknown>

        const depNames = depRels
          .map(r => entityById.get(r.toEntityId)?.name)
          .filter((n): n is string => n !== undefined)
        const callerNames = callerRels
          .map(r => entityById.get(r.fromEntityId)?.name)
          .filter((n): n is string => n !== undefined)

        return {
          id: entity.id,
          name: entity.name,
          health: (meta['health'] as string) ?? 'healthy',
          language: (meta['language'] as string) ?? (repoMeta['language'] as string) ?? 'unknown',
          team: teamEntity?.name ?? (meta['team'] as string) ?? '—',
          oncall: (meta['oncall'] as string) ?? '—',
          repo: repoEntity?.name ?? (meta['repo'] as string) ?? '—',
          version: (meta['version'] as string) ?? '—',
          lastDeploy: (meta['lastDeploy'] as string) ?? '—',
          description: (meta['description'] as string) ?? '',
          dependencies: depNames,
          callers: callerNames,
          activeIncidents: activeIncidents.filter(i =>
            i.title.toLowerCase().includes(entity.name.toLowerCase()) ||
            (i.suggested_root_cause?.toLowerCase().includes(entity.name.toLowerCase()) ?? false)
          ).length,
          metrics: {
            errorRate: (meta['errorRate'] as number) ?? 0,
            p99ms: (meta['p99ms'] as number) ?? 0,
            rps: (meta['rps'] as number) ?? 0,
            uptime: (meta['uptime'] as number) ?? 100,
          },
        }
      })
      return { data: result, nextCursor: hasMore ? data[data.length - 1]!.id : null }
    })
  })

  app.get<{ Params: { id: string } }>(
    '/api/services/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id } = request.params
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string; name: string; status: string; metadata: unknown }>>`
          SELECT id, name, type, metadata FROM entities
          WHERE id = ${id}::uuid AND type = 'Service' AND tenant_id = ${tenantId}::uuid
          LIMIT 1
        `
      ).catch(() => [] as Array<{ id: string; name: string; status: string; metadata: unknown }>)
      if (rows.length === 0) return reply.code(404).send({ error: 'not found' })
      return reply.send(rows[0])
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/services/:id',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { id } = request.params
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          DELETE FROM entities WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND type = 'Service' RETURNING id
        `
      ).catch(() => [] as Array<{ id: string }>)
      if (rows.length === 0) return reply.code(404).send({ error: 'not found' })
      await appendAuditEvent({
        tenantId, userId,
        action: 'service.delete',
        resource: `service:${id}`,
        outcome: 'action_executed',
        metadata: { id },
      }).catch(() => {})
      return reply.send({ deleted: true, id })
    },
  )
}
