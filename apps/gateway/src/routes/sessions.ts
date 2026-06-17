import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { UUID_RE } from '../utils/validators.js'

interface SessionSummaryRow {
  id: string
  created_at: Date
  updated_at: Date
  turn_count: bigint
  preview: string | null
}

interface SessionDetailRow {
  id: string
  created_at: Date
  updated_at: Date
  turn_count: bigint
}

interface TurnRow {
  id: string
  role: string
  content: string
  created_at: Date
}

export async function sessionRoutes(app: FastifyInstance) {
  // List recent sessions for current tenant — derived from session_turns (no sessions table dependency).
  // session_turns.session_id stores client-generated text IDs (session-{ts}-{random}).
  // The sessions table uses UUIDs — incompatible with the client-generated IDs, so we derive
  // session metadata directly from the turns table.
  app.get('/api/sessions', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<SessionSummaryRow[]>`
        SELECT
          session_id AS id,
          MIN(created_at) AS created_at,
          MAX(created_at) AS updated_at,
          COUNT(*) FILTER (WHERE role = 'user') AS turn_count,
          (ARRAY_AGG(content ORDER BY created_at) FILTER (WHERE role = 'user'))[1] AS preview
        FROM session_turns
        WHERE tenant_id = ${tenantId}::uuid
        GROUP BY session_id
        ORDER BY MAX(created_at) DESC
        LIMIT 50
      `
    ).catch(() => [] as SessionSummaryRow[])
    return rows.map(r => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      turnCount: Number(r.turn_count),
      preview: r.preview ?? undefined,
    }))
  })

  // Get single session metadata — derived from session_turns (supports both UUID and text session IDs)
  app.get<{ Params: { id: string } }>('/api/sessions/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    // Try sessions table first (UUID path), fall back to session_turns (text ID path)
    const isUuid = UUID_RE.test(id)
    const rows = await withTenant(prisma, tenantId, (tx) =>
      isUuid
        ? tx.$queryRaw<SessionDetailRow[]>`
            SELECT id, created_at, updated_at, turn_count
            FROM sessions
            WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
            LIMIT 1
          `
        : tx.$queryRaw<SessionDetailRow[]>`
            SELECT
              session_id AS id,
              MIN(created_at) AS created_at,
              MAX(created_at) AS updated_at,
              COUNT(*) FILTER (WHERE role = 'user') AS turn_count
            FROM session_turns
            WHERE tenant_id = ${tenantId}::uuid AND session_id = ${id}
            GROUP BY session_id
          `
    ).catch(() => [] as SessionDetailRow[])
    if (rows.length === 0) return reply.code(404).send({ error: 'session not found' })
    const r = rows[0]!
    return {
      id: r.id,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      turnCount: Number(r.turn_count),
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
