import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { UUID_RE } from '../utils/validators.js'

interface SessionRow {
  id: string
  user_id: string | null
  created_at: Date
  expires_at: Date
  updated_at: Date
  turn_count: number
  preview?: string | null
}

interface TurnRow {
  id: string
  role: string
  content: string
  created_at: Date
}

export async function sessionRoutes(app: FastifyInstance) {
  // List recent sessions for current tenant
  app.get('/api/sessions', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<SessionRow[]>`
        SELECT s.id, s.user_id, s.created_at, s.expires_at, s.updated_at, s.turn_count,
               t.content AS preview
        FROM sessions s
        LEFT JOIN LATERAL (
          SELECT content FROM session_turns
          WHERE session_id = s.id AND tenant_id = ${tenantId}::uuid AND role = 'user'
          ORDER BY created_at ASC LIMIT 1
        ) t ON true
        WHERE s.tenant_id = ${tenantId}::uuid
        ORDER BY s.updated_at DESC LIMIT 50
      `
    ).catch(() => [] as SessionRow[])
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      turnCount: r.turn_count,
      preview: r.preview ?? undefined,
    }))
  })

  // Get single session
  app.get<{ Params: { id: string } }>('/api/sessions/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<SessionRow[]>`
        SELECT id, user_id, created_at, expires_at, updated_at, turn_count
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
      updatedAt: r.updated_at.toISOString(),
      turnCount: r.turn_count,
    }
  })

  // Get turns for a session — supports both UUID and text session IDs
  app.get<{ Params: { id: string } }>('/api/sessions/:id/turns', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    // id is session_id (text, not UUID) — handles both UUID and text session ids
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<TurnRow[]>`
        SELECT id, role, content, created_at FROM session_turns
        WHERE tenant_id = ${tenantId}::uuid AND session_id = ${id}
        ORDER BY created_at ASC LIMIT 200
      `
    ).catch(() => [] as TurnRow[])
    return reply.send({
      data: rows.map(r => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.created_at.toISOString(),
      })),
    })
  })
}
