import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
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

      const targetUserRows = await withTenant(prisma, user.tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM users WHERE id = ${userId}::uuid AND tenant_id = ${user.tenantId}::uuid LIMIT 1
        `
      ).catch(() => [])
      if (targetUserRows.length === 0) return reply.code(404).send({ error: 'user not found' })

      const audit = new PostgresAuditSink(prisma, (err) => request.log.error({ err }, 'access audit write failed'))
      let count = 0
      let failed = 0
      const prunedNames: string[] = []

      // Wrap all upserts and DELETE in a single withTenant transaction
      await withTenant(prisma, user.tenantId, async (tx) => {
        for (const p of request.body.perimeter) {
          try {
            await tx.$executeRaw`
              INSERT INTO user_perimeters (tenant_id, user_id, connector_name, read_scopes, write_scopes)
              VALUES (${user.tenantId}::uuid, ${userId}::uuid, ${p.connectorName},
                ${p.readScopes}::text[], ${p.writeScopes}::text[])
              ON CONFLICT (tenant_id, user_id, connector_name)
              DO UPDATE SET read_scopes = ${p.readScopes}::text[], write_scopes = ${p.writeScopes}::text[]
            `
            count++
          } catch { failed++ }
        }
        // Only DELETE after all upserts succeed
        if (failed === 0) {
          const submittedNames = request.body.perimeter.map(p => p.connectorName)
          const removed = await tx.$queryRaw<Array<{ connector_name: string }>>`
            DELETE FROM user_perimeters
            WHERE tenant_id = ${user.tenantId}::uuid
              AND user_id = ${userId}::uuid
              AND connector_name != ALL(${submittedNames}::text[])
            RETURNING connector_name
          `.catch(() => [] as Array<{ connector_name: string }>)
          for (const r of removed) prunedNames.push(r.connector_name)
        }
      })

      // Audit events per upsert
      for (const p of request.body.perimeter.slice(0, count)) {
        await audit.append({
          id: crypto.randomUUID(),
          tenantId: user.tenantId as import('@anvay/types').TenantId,
          userId: user.sub as import('@anvay/types').UserId,
          sessionId: '' as import('@anvay/types').SessionId,
          eventType: 'perimeter_changed',
          payload: { userId, connectorName: p.connectorName, readScopes: p.readScopes, writeScopes: p.writeScopes },
          createdAt: new Date(),
        }).catch((err) => request.log.error({ err }, 'perimeter_changed audit write failed'))
      }

      // Audit removed connectors
      for (const name of prunedNames) {
        await audit.append({
          id: crypto.randomUUID(),
          tenantId: user.tenantId as import('@anvay/types').TenantId,
          userId: user.sub as import('@anvay/types').UserId,
          sessionId: '' as import('@anvay/types').SessionId,
          eventType: 'perimeter_removed',
          payload: { userId, connectorName: name },
          createdAt: new Date(),
        }).catch((err) => request.log.error({ err }, 'perimeter_removed audit write failed'))
      }
      if (failed > 0) {
        reply.code(207)
        return { ok: false, count, failed }
      }
      return { ok: true, count }
    },
  )

  // POST /api/access/users — provision new user (admin only)
  app.post<{ Body: { email: string; role: string } }>(
    '/api/access/users',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['email', 'role'],
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'sre', 'dev', 'pm', 'ba'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string }
      if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })
      const { email, role } = request.body
      const newId = crypto.randomUUID()
      const rows = await withTenant(prisma, user.tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string; email: string; role: string }>>`
          INSERT INTO users (id, tenant_id, email, role)
          VALUES (${newId}::uuid, ${user.tenantId}::uuid, ${email}, ${Prisma.raw(`'${role}'`)}::\"AgentRole\")
          ON CONFLICT (tenant_id, email) DO UPDATE SET role = EXCLUDED.role
          RETURNING id, email, role
        `
      ).catch(() => [])
      if (rows.length === 0) return reply.code(500).send({ error: 'failed to provision user' })
      return reply.code(201).send(rows[0])
    },
  )

  // PATCH /api/access/users/:userId/role — update user role (admin only)
  app.patch<{ Params: { userId: string }; Body: { role: string } }>(
    '/api/access/users/:userId/role',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          properties: {
            role: { type: 'string', enum: ['admin', 'sre', 'dev', 'pm', 'ba'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string }
      if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })
      const { userId } = request.params
      if (!UUID_RE.test(userId)) return reply.code(400).send({ error: 'invalid userId' })
      const { role } = request.body
      const affected = await withTenant(prisma, user.tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE users SET role = ${Prisma.raw(`'${role}'`)}::\"AgentRole\" WHERE id = ${userId}::uuid AND tenant_id = ${user.tenantId}::uuid
        `
      ).catch(() => 0)
      if (Number(affected) === 0) return reply.code(404).send({ error: 'user not found' })
      return { ok: true }
    },
  )
}
