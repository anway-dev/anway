import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'

interface EnvRow {
  id: string
  name: string
  label: string
  color: string
  sort_order: number
  created_at: Date
  updated_at: Date
}

// Connector types that are global (not env-scoped):
// source control, issue tracking, collaboration, CI, code quality, secrets
export const GLOBAL_CONNECTOR_TYPES = new Set([
  'github', 'gitlab', 'bitbucket',
  'linear', 'jira',
  'slack', 'confluence', 'notion',
  'sentry', 'snyk', 'sonarqube',
  'circleci', 'jenkins',
  'launchdarkly',
  'vault',
])

export async function environmentRoutes(app: FastifyInstance) {
  // GET /api/environments
  app.get('/api/environments', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }

    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<EnvRow[]>`
        SELECT id, name, label, color, sort_order, created_at, updated_at
        FROM environments
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY sort_order ASC, created_at ASC
      `,
    ).catch(() => [] as EnvRow[])

    // Seed defaults on first access if no envs configured yet
    if (rows.length === 0) {
      const defaults = [
        { name: 'staging', label: 'Staging',        color: '#3b82f6', sort_order: 0 },
        { name: 'preprod', label: 'Pre-production',  color: '#f59e0b', sort_order: 1 },
        { name: 'prod',    label: 'Production',      color: '#ef4444', sort_order: 2 },
      ]
      for (const d of defaults) {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            INSERT INTO environments (id, tenant_id, name, label, color, sort_order, created_at, updated_at)
            VALUES (gen_random_uuid(), ${tenantId}::uuid, ${d.name}, ${d.label}, ${d.color}, ${d.sort_order}, now(), now())
            ON CONFLICT DO NOTHING
          `,
        ).catch(() => null)
      }
      return reply.send(defaults.map((d, i) => ({ id: `seed-${i}`, ...d, createdAt: new Date(), updatedAt: new Date() })))
    }

    return reply.send(rows.map(r => ({
      id: r.id,
      name: r.name,
      label: r.label,
      color: r.color,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })))
  })

  // POST /api/environments — create env
  app.post<{ Body: { name: string; label: string; color?: string } }>(
    '/api/environments',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { name, label, color } = request.body

      if (!name || !label) return reply.code(400).send({ error: 'name and label required' })
      if (!/^[a-z0-9-]+$/.test(name)) return reply.code(400).send({ error: 'name must be lowercase alphanumeric with hyphens' })

      // Sort order = max + 1
      const maxRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ max: number }>>`
          SELECT COALESCE(MAX(sort_order), -1) AS max FROM environments
          WHERE tenant_id = ${tenantId}::uuid
        `,
      ).catch(() => [{ max: -1 }])
      const sortOrder = (maxRows[0]?.max ?? -1) + 1

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO environments (id, tenant_id, name, label, color, sort_order, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${name}, ${label}, ${color ?? '#888888'}, ${sortOrder}, now(), now())
          RETURNING id
        `,
      ).catch((err: Error) => {
        if (err.message?.includes('unique')) throw Object.assign(new Error('env name already exists'), { statusCode: 409 })
        return [] as Array<{ id: string }>
      })

      if (rows.length === 0) return reply.code(500).send({ error: 'create failed' })

      return reply.code(201).send({ id: rows[0]!.id, name, label, color: color ?? '#888888', sortOrder })
    },
  )

  // PATCH /api/environments/:id — update label, color, sort_order
  app.patch<{ Params: { id: string }; Body: { label?: string; color?: string; sortOrder?: number } }>(
    '/api/environments/:id',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id } = request.params
      const { label, color, sortOrder } = request.body

      if (label !== undefined) {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            UPDATE environments SET label = ${label}, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          `,
        ).catch(() => null)
      }
      if (color !== undefined) {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            UPDATE environments SET color = ${color}, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          `,
        ).catch(() => null)
      }
      if (sortOrder !== undefined) {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            UPDATE environments SET sort_order = ${sortOrder}, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          `,
        ).catch(() => null)
      }

      return reply.send({ updated: true })
    },
  )

  // DELETE /api/environments/:id
  app.delete<{ Params: { id: string } }>(
    '/api/environments/:id',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id } = request.params

      // Don't delete last environment
      const count = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM environments WHERE tenant_id = ${tenantId}::uuid
        `,
      ).catch(() => [{ count: 0n }])
      if ((count[0]?.count ?? 0n) <= 1n) {
        return reply.code(400).send({ error: 'cannot delete last environment' })
      }

      await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          DELETE FROM environments WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
        `,
      ).catch(() => null)

      return reply.send({ deleted: true })
    },
  )

  // GET /api/environments/:envName/connectors — connectors scoped to this env
  app.get<{ Params: { envName: string } }>(
    '/api/environments/:envName/connectors',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { envName } = request.params

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ connector_type: string; enabled: boolean; bootstrapped_at: Date | null }>>`
          SELECT cc.connector_type, cc.enabled, cc.bootstrapped_at
          FROM connector_config cc
          JOIN environments e ON e.id = cc.env_id
          WHERE cc.tenant_id = ${tenantId}::uuid
            AND e.tenant_id = ${tenantId}::uuid
            AND e.name = ${envName}
        `,
      ).catch(() => [])

      return reply.send(rows.map(r => ({
        connectorType: r.connector_type,
        enabled: r.enabled,
        bootstrappedAt: r.bootstrapped_at,
      })))
    },
  )
}
