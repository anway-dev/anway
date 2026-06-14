import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

interface SessionRow {
  id: string
  user_id: string | null
  created_at: Date
  expires_at: Date
}

export async function sessionRoutes(app: FastifyInstance) {
  // List recent sessions for current tenant
  app.get('/api/sessions', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<SessionRow[]>`
        SELECT id, user_id, created_at, expires_at
        FROM sessions
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY created_at DESC LIMIT 50
      `
    ).catch(() => [] as SessionRow[])
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    }))
  })

  // Get single session
  app.get<{ Params: { id: string } }>('/api/sessions/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<SessionRow[]>`
        SELECT id, user_id, created_at, expires_at
        FROM sessions
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
        LIMIT 1
      `
    ).catch(() => [] as SessionRow[])
    if (rows.length === 0) return reply.code(404).send({ error: 'session not found' })
    const r = rows[0]!
    return {
      id: r.id,
      userId: r.user_id,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    }
  })
}
