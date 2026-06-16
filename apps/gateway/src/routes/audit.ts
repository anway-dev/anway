import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

interface AuditEvent {
  id: string
  timestamp: string
  user: string
  authRole: string
  inferredRole: string
  query: string
  agents: string[]
  outcome: 'root_cause_found' | 'answer_provided' | 'status_provided' | 'analysis_provided' | 'pr_created' | 'gate_required' | 'auto_approved' | 'access_denied' | 'rollback_initiated' | 'blocked' | 'action_executed' | 'action_failed'
  detail: string
  durationMs: number
}

interface AuditRow {
  id: string
  event_type: string
  payload: Record<string, unknown>
  created_at: Date
  user_id: string | null
}

export async function appendAuditEvent(params: {
  tenantId: string
  userId: string
  action: string
  resource: string
  outcome: string
  metadata: Record<string, unknown>
}): Promise<void> {
  await withTenant(prisma, params.tenantId, (tx) =>
    tx.$executeRaw`
      INSERT INTO audit_events (id, tenant_id, user_id, event_type, payload, created_at)
      VALUES (gen_random_uuid(), ${params.tenantId}::uuid, ${params.userId}::uuid,
              ${params.action},
              ${JSON.stringify({
                resource: params.resource,
                outcome: params.outcome,
                ...params.metadata,
              })}::jsonb,
              NOW())
    `
  )
}

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { cursor, limit: limitStr } = request.query as { cursor?: string; limit?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)

    // Cursor is ISO timestamp — ORDER BY created_at DESC for true chronological order
    const cursorDate = cursor ? new Date(cursor) : null

    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<AuditRow[]>`
        SELECT id, event_type, payload, created_at, user_id
        FROM audit_events
        ${cursorDate ? Prisma.sql`WHERE created_at < ${cursorDate}` : Prisma.sql``}
        ORDER BY created_at DESC
        LIMIT ${limit + 1}
      `
    ).catch(() => [] as AuditRow[])

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows

    return {
      data: data.map(r => {
      const p = (r.payload ?? {}) as Record<string, unknown>
      return {
        id: r.id,
        timestamp: r.created_at.toISOString(),
        user: r.user_id?.slice(0, 8) ?? 'system',
        authRole: (p['authRole'] as string) ?? 'system',
        inferredRole: (p['inferredRole'] as string) ?? (p['authRole'] as string) ?? 'system',
        query: (p['query'] as string) ?? r.event_type,
        agents: ((p['agents'] as string[]) ?? []),
        outcome: mapOutcome(r.event_type, p),
        detail: (p['detail'] as string) ?? (p['message'] as string) ?? '',
        durationMs: (p['durationMs'] as number) ?? 0,
      } as AuditEvent
    }),
      nextCursor: hasMore ? data[data.length - 1]!.created_at.toISOString() : null,
    }
  })

  // X1: Audit log export — admin only, NDJSON download
  app.get('/api/audit/export', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const user = request.user as { tenantId: string; role?: string }
    const { tenantId } = user
    if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })

    const q = request.query as Record<string, string>
    let from: Date | undefined
    let to: Date | undefined
    if (q['from']) {
      const d = new Date(q['from'])
      if (!isNaN(d.getTime())) from = d
    }
    if (q['to']) {
      const d = new Date(q['to'])
      if (!isNaN(d.getTime())) to = d
    }

    const rows = await withTenant(prisma, tenantId, (tx) => {
      if (from && to) {
        return tx.$queryRaw<AuditRow[]>`
          SELECT id, event_type, payload, created_at, user_id
          FROM audit_events
          WHERE created_at >= ${from} AND created_at <= ${to}
          ORDER BY created_at ASC LIMIT 10000
        `
      }
      if (from) {
        return tx.$queryRaw<AuditRow[]>`
          SELECT id, event_type, payload, created_at, user_id
          FROM audit_events
          WHERE created_at >= ${from}
          ORDER BY created_at ASC LIMIT 10000
        `
      }
      if (to) {
        return tx.$queryRaw<AuditRow[]>`
          SELECT id, event_type, payload, created_at, user_id
          FROM audit_events
          WHERE created_at <= ${to}
          ORDER BY created_at ASC LIMIT 10000
        `
      }
      return tx.$queryRaw<AuditRow[]>`
        SELECT id, event_type, payload, created_at, user_id
        FROM audit_events
        ORDER BY created_at ASC LIMIT 10000
      `
    }).catch(() => [] as AuditRow[])

    const body = rows.map(r => JSON.stringify(r)).join('\n')
    return reply
      .header('Content-Type', 'application/x-ndjson')
      .header('Content-Disposition', 'attachment; filename="audit-export.ndjson"')
      .send(body)
  })
}

function mapOutcome(eventType: string, payload: Record<string, unknown>): AuditEvent['outcome'] {
  const outcomeMap: Record<string, AuditEvent['outcome']> = {
    'query_completed': 'root_cause_found',
    'gate_required': 'gate_required',
    'gate_approved': 'auto_approved',
    'access_denied': 'access_denied',
    'action_executed': 'action_executed',
    'action_failed': 'action_failed',
    'pr_created': 'pr_created',
    'incident_created': 'root_cause_found',
    'incident_resolved': 'status_provided',
  }
  return outcomeMap[eventType] ?? ((payload['outcome'] as AuditEvent['outcome']) ?? 'answer_provided')
}
