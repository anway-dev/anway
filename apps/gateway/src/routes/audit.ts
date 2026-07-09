import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { redactSecrets } from '../utils/redact.js'
import { UUID_RE } from '../utils/validators.js'
import { auditAndDenyIfNotAdmin } from '../plugins/rbac.js'

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
  userId?: string
  action: string
  resource: string
  outcome: string
  metadata: Record<string, unknown>
}): Promise<void> {
  const userId = params.userId ?? null
  await withTenant(prisma, params.tenantId, (tx) =>
    userId
      ? tx.$executeRaw`
          INSERT INTO audit_events (id, tenant_id, user_id, event_type, payload, created_at)
          VALUES (gen_random_uuid(), ${params.tenantId}::uuid, ${userId}::uuid,
                  ${params.action},
                  ${JSON.stringify(redactSecrets({
                    resource: params.resource,
                    outcome: params.outcome,
                    ...params.metadata,
                  }) as object)}::jsonb,
                  NOW())
        `
      : tx.$executeRaw`
          INSERT INTO audit_events (id, tenant_id, user_id, event_type, payload, created_at)
          VALUES (gen_random_uuid(), ${params.tenantId}::uuid, NULL,
                  ${params.action},
                  ${JSON.stringify(redactSecrets({
                    resource: params.resource,
                    outcome: params.outcome,
                    ...params.metadata,
                  }) as object)}::jsonb,
                  NOW())
        `
  )
}

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { cursor, limit: limitStr } = request.query as { cursor?: string; limit?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)

    // Composite cursor (created_at, id) — prevents row loss/duplication when
    // multiple events share the same timestamp (common in a single session).
    let cursorDate: Date | null = null
    let cursorId: string | null = null
    if (cursor) {
      const sepIdx = cursor.lastIndexOf(',')
      if (sepIdx > 0) {
        cursorDate = new Date(cursor.slice(0, sepIdx))
        cursorId = cursor.slice(sepIdx + 1)
      } else {
        cursorDate = new Date(cursor)
      }
      if (isNaN(cursorDate.getTime()) || (cursorId !== null && !UUID_RE.test(cursorId))) {
        return reply.code(400).send({ error: 'invalid cursor' })
      }
    }

    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<AuditRow[]>`
        SELECT id, event_type, payload, created_at, user_id
        FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid
        ${cursorDate && cursorId
          ? Prisma.sql`AND (created_at, id) < (${cursorDate}, ${cursorId}::uuid)`
          : cursorDate
            ? Prisma.sql`AND created_at < ${cursorDate}`
            : Prisma.sql``}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `
    ).catch(() => [] as AuditRow[])

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    const last = data[data.length - 1]

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
      nextCursor: hasMore && last ? `${last.created_at.toISOString()},${last.id}` : null,
    }
  })

  // Audit intelligence — CLAUDE.md: "Audit feeds intelligence — org-level
  // query patterns, bottleneck detection, usage analytics". Confirmed via
  // independent review: audit_events was written everywhere and read only
  // by the raw audit-log UI — zero aggregation, no learning loop. One
  // admin-gated endpoint aggregating the 7-day window:
  //   - intents: what the org actually asks (top classified intents)
  //   - activityByDay: query volume trend
  //   - toolCalls: allowed vs hard-blocked + the top blocked tools
  //     (bottleneck signal — repeated blocks = perimeter friction or a
  //     misconfigured connector scope)
  //   - gates: approval vs rejection counts (trust signal)
  //   - graphMisses: entities users asked about that the graph doesn't
  //     know (KB coverage gaps — each one is a bootstrap-worth candidate)
  //   - roleInferences: how often users work outside their provisioned role
  app.get('/api/audit/insights', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const user = request.user as { tenantId: string; role?: string }
    if (await auditAndDenyIfNotAdmin(request, reply)) return
    const { tenantId } = user

    const [intents, activityByDay, toolCallCounts, topBlockedTools, gates, graphMisses, roleInferences] = await Promise.all([
      withTenant(prisma, tenantId, (tx) => tx.$queryRaw<Array<{ intent: string; count: bigint }>>`
        SELECT payload->>'intent' AS intent, COUNT(*) AS count FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid AND event_type = 'agent_spawned'
          AND created_at > NOW() - INTERVAL '7 days' AND payload->>'intent' IS NOT NULL
        GROUP BY 1 ORDER BY count DESC LIMIT 10
      `).catch(() => []),
      withTenant(prisma, tenantId, (tx) => tx.$queryRaw<Array<{ day: string; count: bigint }>>`
        SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*) AS count FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid AND event_type = 'query_received'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY 1 ORDER BY 1
      `).catch(() => []),
      withTenant(prisma, tenantId, (tx) => tx.$queryRaw<Array<{ event_type: string; count: bigint }>>`
        SELECT event_type, COUNT(*) AS count FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid AND event_type IN ('tool_call_allowed', 'tool_call_blocked')
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY 1
      `).catch(() => []),
      withTenant(prisma, tenantId, (tx) => tx.$queryRaw<Array<{ tool: string; count: bigint }>>`
        SELECT payload->>'toolName' AS tool, COUNT(*) AS count FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid AND event_type = 'tool_call_blocked'
          AND created_at > NOW() - INTERVAL '7 days' AND payload->>'toolName' IS NOT NULL
        GROUP BY 1 ORDER BY count DESC LIMIT 10
      `).catch(() => []),
      withTenant(prisma, tenantId, (tx) => tx.$queryRaw<Array<{ decision: string; count: bigint }>>`
        SELECT payload->>'decision' AS decision, COUNT(*) AS count FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid AND event_type = 'gate_decision'
          AND created_at > NOW() - INTERVAL '7 days' AND payload->>'decision' IS NOT NULL
        GROUP BY 1
      `).catch(() => []),
      withTenant(prisma, tenantId, (tx) => tx.$queryRaw<Array<{ entity: string; count: bigint }>>`
        SELECT payload->>'entityName' AS entity, COUNT(*) AS count FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid AND event_type = 'graph_miss'
          AND created_at > NOW() - INTERVAL '7 days' AND payload->>'entityName' IS NOT NULL
        GROUP BY 1 ORDER BY count DESC LIMIT 10
      `).catch(() => []),
      withTenant(prisma, tenantId, (tx) => tx.$queryRaw<Array<{ auth_role: string; inferred_role: string; count: bigint }>>`
        SELECT payload->>'authRole' AS auth_role, payload->>'inferredRole' AS inferred_role, COUNT(*) AS count
        FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid AND event_type = 'role_inferred'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY 1, 2 ORDER BY count DESC LIMIT 10
      `).catch(() => []),
    ])

    const allowed = Number((toolCallCounts as Array<{ event_type: string; count: bigint }>).find(t => t.event_type === 'tool_call_allowed')?.count ?? 0n)
    const blocked = Number((toolCallCounts as Array<{ event_type: string; count: bigint }>).find(t => t.event_type === 'tool_call_blocked')?.count ?? 0n)

    return {
      windowDays: 7,
      intents: (intents as Array<{ intent: string; count: bigint }>).map(r => ({ intent: r.intent, count: Number(r.count) })),
      activityByDay: (activityByDay as Array<{ day: string; count: bigint }>).map(r => ({ day: r.day, count: Number(r.count) })),
      toolCalls: { allowed, blocked, blockRate: allowed + blocked > 0 ? blocked / (allowed + blocked) : 0 },
      topBlockedTools: (topBlockedTools as Array<{ tool: string; count: bigint }>).map(r => ({ tool: r.tool, count: Number(r.count) })),
      gates: (gates as Array<{ decision: string; count: bigint }>).map(r => ({ decision: r.decision, count: Number(r.count) })),
      graphMisses: (graphMisses as Array<{ entity: string; count: bigint }>).map(r => ({ entity: r.entity, count: Number(r.count) })),
      roleInferences: (roleInferences as Array<{ auth_role: string; inferred_role: string; count: bigint }>).map(r => ({ authRole: r.auth_role, inferredRole: r.inferred_role, count: Number(r.count) })),
    }
  })

  // X1: Audit log export — admin only, NDJSON download
  app.get('/api/audit/export', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const user = request.user as { tenantId: string; role?: string; sub?: string }
    const { tenantId } = user
    if (user.role !== 'admin') {
      await appendAuditEvent({
        tenantId,
        ...(user.sub ? { userId: user.sub } : {}),
        action: 'access_denied',
        resource: request.url,
        outcome: 'blocked',
        metadata: { method: request.method, required: ['admin'], actual: user.role ?? 'none' },
      }).catch(() => {})
      return reply.code(403).send({ error: 'admin role required' })
    }

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
          WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${from} AND created_at <= ${to}
          ORDER BY created_at ASC LIMIT 10000
        `
      }
      if (from) {
        return tx.$queryRaw<AuditRow[]>`
          SELECT id, event_type, payload, created_at, user_id
          FROM audit_events
          WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${from}
          ORDER BY created_at ASC LIMIT 10000
        `
      }
      if (to) {
        return tx.$queryRaw<AuditRow[]>`
          SELECT id, event_type, payload, created_at, user_id
          FROM audit_events
          WHERE tenant_id = ${tenantId}::uuid AND created_at <= ${to}
          ORDER BY created_at ASC LIMIT 10000
        `
      }
      return tx.$queryRaw<AuditRow[]>`
        SELECT id, event_type, payload, created_at, user_id
        FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY created_at ASC LIMIT 10000
      `
    }).catch(() => [] as AuditRow[])

    const body = rows.map(r => JSON.stringify({ ...r, payload: redactSecrets(r.payload as Record<string, unknown>) })).join('\n')
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
    'gate_approved': 'action_executed',
    'access_denied': 'access_denied',
    'action_executed': 'action_executed',
    'action_failed': 'action_failed',
    'pr_created': 'pr_created',
    'incident_created': 'root_cause_found',
    'incident_resolved': 'status_provided',
  }
  return outcomeMap[eventType] ?? ((payload['outcome'] as AuditEvent['outcome']) ?? 'answer_provided')
}
