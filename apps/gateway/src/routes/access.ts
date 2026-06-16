import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { UUID_RE } from '../utils/validators.js'
import { PostgresAuditSink } from '../audit/postgres-sink.js'

export async function accessRoutes(app: FastifyInstance) {
  // GET /api/access/users — list all users in tenant (admin only)
  app.get(
    '/api/access/users',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string }
      if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })
      const rows = await withTenant(prisma, user.tenantId, (tx) =>
        tx.$queryRaw<{ id: string; email: string; role: string; created_at: Date }[]>`
          SELECT id, email, role, created_at FROM users ORDER BY email
        `
      ).catch(() => [])
      return rows.map(r => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at }))
    },
  )

  // GET /api/access/users/:userId/perimeter — read user's connector permissions
  app.get<{ Params: { userId: string } }>(
    '/api/access/users/:userId/perimeter',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string }
      if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })
      const { userId } = request.params
      if (!UUID_RE.test(userId)) return reply.code(400).send({ error: 'invalid userId' })
      const rows = await withTenant(prisma, user.tenantId, (tx) =>
        tx.$queryRaw<{ connector_name: string; read_scopes: string[]; write_scopes: string[] }[]>`
          SELECT connector_name, read_scopes, write_scopes FROM user_perimeters
          WHERE tenant_id = ${user.tenantId}::uuid AND user_id = ${userId}::uuid
          ORDER BY connector_name
        `
      ).catch(() => [])
      return rows.map(r => ({
        connectorName: r.connector_name,
        readScopes: r.read_scopes,
        writeScopes: r.write_scopes,
      }))
    },
  )

  // PUT /api/access/users/:userId/perimeter — upsert user's connector permissions
  app.put<{ Params: { userId: string }; Body: { perimeter: Array<{ connectorName: string; readScopes: string[]; writeScopes: string[] }> } }>(
    '/api/access/users/:userId/perimeter',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['perimeter'],
          properties: {
            perimeter: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['connectorName', 'readScopes', 'writeScopes'],
                additionalProperties: false,
                properties: {
                  connectorName: { type: 'string', minLength: 1, maxLength: 100 },
                  readScopes: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 200 } },
                  writeScopes: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 200 } },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string; sub: string }
      if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })
      const { userId } = request.params
      if (!UUID_RE.test(userId)) return reply.code(400).send({ error: 'invalid userId' })

      const audit = new PostgresAuditSink(prisma, (err) => request.log.error({ err }, 'access audit write failed'))
      let count = 0

      for (const p of request.body.perimeter) {
        await withTenant(prisma, user.tenantId, (tx) =>
          tx.$executeRaw`
            INSERT INTO user_perimeters (tenant_id, user_id, connector_name, read_scopes, write_scopes)
            VALUES (${user.tenantId}::uuid, ${userId}::uuid, ${p.connectorName},
              ${p.readScopes}::text[], ${p.writeScopes}::text[])
            ON CONFLICT (tenant_id, user_id, connector_name)
            DO UPDATE SET read_scopes = ${p.readScopes}::text[], write_scopes = ${p.writeScopes}::text[]
          `
        ).catch(() => {})
        count++

        void audit.append({
          id: crypto.randomUUID(),
          tenantId: user.tenantId as import('@anvay/types').TenantId,
          userId: user.sub as import('@anvay/types').UserId,
          sessionId: '' as import('@anvay/types').SessionId,
          eventType: 'perimeter_changed',
          payload: { userId, connectorName: p.connectorName, readScopes: p.readScopes, writeScopes: p.writeScopes },
          createdAt: new Date(),
        })
      }
      return { ok: true, count }
    },
  )
}
