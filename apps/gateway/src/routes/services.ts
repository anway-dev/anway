import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

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
}

export async function serviceRoutes(app: FastifyInstance) {
  app.get('/api/services', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }

    return withTenant(prisma, tenantId, async (tx) => {
      // RLS filters by tenant — no need to repeat tenant_id in WHERE
      const entities = await tx.$queryRaw<EntityRow[]>`
        SELECT id, name, type, metadata FROM entities WHERE type = 'Service' ORDER BY name LIMIT 500
      `
      if (entities.length === 0) return []

      const allEntities = await tx.$queryRaw<EntityRow[]>`
        SELECT id, name, type, metadata FROM entities LIMIT 1000
      `
      const allRels = await tx.$queryRaw<RelRow[]>`
        SELECT from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId"
        FROM relationships LIMIT 2000
      `
      const activeIncidents = await tx.$queryRaw<IncidentRow[]>`
        SELECT title, status FROM incidents WHERE status IN ('active', 'investigating') ORDER BY created_at DESC LIMIT 100
      `

      const entityById = new Map(allEntities.map(e => [e.id, e]))

      return entities.map(entity => {
        const meta = (entity.metadata ?? {}) as Record<string, unknown>

        const ownedByRel = allRels.find(r => r.fromEntityId === entity.id && r.relType === 'OWNED_BY')
        const hostedInRel = allRels.find(r => r.fromEntityId === entity.id && r.relType === 'HOSTED_IN')
        const depRels = allRels.filter(r => r.fromEntityId === entity.id && r.relType === 'DEPENDS_ON')
        const callerRels = allRels.filter(r => r.toEntityId === entity.id && r.relType === 'DEPENDS_ON')

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
            i.title.toLowerCase().includes(entity.name.toLowerCase())
          ).length,
          metrics: {
            errorRate: (meta['errorRate'] as number) ?? 0,
            p99ms: (meta['p99ms'] as number) ?? 0,
            rps: (meta['rps'] as number) ?? 0,
            uptime: (meta['uptime'] as number) ?? 100,
          },
        }
      })
    })
  })
}
