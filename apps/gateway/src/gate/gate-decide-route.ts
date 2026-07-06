import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { RedisGateSink } from './redis-gate-sink.js'
import { getMemoryGateSink } from './memory-gate-fallback.js'
import { UUID_RE } from '../utils/validators.js'
import { gateDecisionsTotal } from '../metrics.js'
import { requireRole } from '../plugins/rbac.js'
import { executeTriggerAction } from '../triggers/actions.js'

const TRIGGER_ACTION_TYPES = new Set([
  'notify_oncall', 'create_incident', 'run_runbook', 'notify_channel',
  'escalate', 'block_deploy_gate', 'open_war_room', 'surface_context',
])

/**
 * Resolve a representative connector id for a manually-created gate
 * (POST /api/gate). Same intent as executor.ts's actionTypeToConnector but
 * covers the broader verb set admins pass here (deploy/restart_pod/scale/
 * cordon/terraform.apply/...) since this route has no upstream tool-call
 * context to read a real connectorId from (unlike RedisGateSink.push, which
 * receives event.connectorId from the orchestrator's tool-call metadata).
 */
export function resolveConnectorId(action: string, scope?: string): string {
  if (scope && scope !== '*') return scope
  const a = action.toLowerCase()
  if (a.startsWith('terraform')) return 'terraform'
  if (a === 'deploy' || a.startsWith('deploy.') || a === 'trigger_pipeline' || a === 'approve_gate') return 'argocd'
  if (a === 'restart' || a === 'restart_pod' || a === 'scale' || a === 'cordon' || a.startsWith('k8s.')) return 'k8s'
  if (a === 'notify_oncall' || a === 'escalate') return 'pagerduty'
  if (a === 'notify_channel') return 'slack'
  if (a === 'block_deploy_gate') return 'argocd'
  const dot = a.indexOf('.')
  if (dot > 0) return a.slice(0, dot)
  return 'system'
}

const redisUrl = process.env['REDIS_URL']
const gateSink = redisUrl ? new RedisGateSink(redisUrl) : null

export async function gateDecideRoutes(app: FastifyInstance) {
  // GET /api/gate/:id — fetch a specific gate event by ID
  app.get<{ Params: { id: string } }>('/api/gate/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string; status: string; tool_name: string; created_at: Date }>>`
        SELECT id, status, tool_name, created_at FROM gate_events
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `
    ).catch(() => [] as Array<{ id: string; status: string; tool_name: string; created_at: Date }>)
    if (rows.length === 0) return reply.code(404).send({ error: 'not found' })
    return reply.send(rows[0])
  })

  // GET /api/gate/pending — list all pending gate events for the tenant
  app.get('/api/gate/pending', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string; tool_name: string; tool_args: Record<string, unknown> | null; created_at: Date }>>`
        SELECT id, tool_name, tool_args, created_at
        FROM gate_events
        WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 50
      `
    ).catch(() => [])
    return rows.map(r => ({
      id: r.id,
      toolName: r.tool_name,
      description: typeof r.tool_args?.target === 'string'
        ? `${r.tool_name.replace(/_/g, ' ')} — ${r.tool_args.target}`
        : r.tool_name.replace(/_/g, ' '),
      createdAt: r.created_at.toISOString(),
    }))
  })

  app.post<{ Params: { gateId: string }; Body: { decision: 'approved' | 'rejected' } }>(
    '/api/gate/:gateId/decide', {
      preHandler: [app.authenticate, requireRole('admin', 'sre')],
      schema: {
        body: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['approved', 'rejected'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { gateId } = request.params
      if (!UUID_RE.test(gateId)) return reply.code(400).send({ error: 'invalid gateId' })
      const { decision } = request.body
      const { sub: userId, tenantId } = request.user as { sub: string; tenantId: string }

      // SoD: look up gate owner + tool info before Redis/in-memory split — applies to both paths
      const gateRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ user_id: string; tool_name: string; tool_args: Record<string, unknown> | null; connector_id: string }>>`
          SELECT user_id, tool_name, tool_args, connector_id FROM gate_events
          WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending' LIMIT 1
        `
      ).catch(() => [] as Array<{ user_id: string; tool_name: string; tool_args: Record<string, unknown> | null; connector_id: string }>)

      if (gateRows.length === 0) {
        return reply.code(404).send({ error: 'gate not found or already decided' })
      }
      // SoD must be checked before any vote is recorded below — moving this
      // after the vote-insert (a real bug caught before it shipped) would
      // let the requester's own vote count toward the approval threshold.
      if (gateRows[0]!.user_id === userId) {
        return reply.code(403).send({ error: 'cannot approve your own gate request' })
      }

      // Multi-approver support: gate_policies.approvers_required was stored
      // but never enforced anywhere — every gate resolved on exactly one
      // approval regardless of configured policy, confirmed live via
      // independent review. Record this approver's vote in gate_approvals
      // (one row per distinct approver, UNIQUE(gate_id, approver_id) so the
      // same person can't inflate the count by voting twice), then only
      // actually flip gate_events.status once enough distinct approvals
      // exist. A single rejection still kills the gate immediately — a
      // standard, safe default for reject semantics.
      let fullyResolved = decision === 'rejected'
      let votesReceived = 0
      let votesRequired = 1
      if (gateRows.length > 0) {
        const alreadyVoted = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM gate_approvals WHERE gate_id = ${gateId}::uuid AND approver_id = ${userId}::uuid LIMIT 1
          `
        ).catch(() => [])
        if (alreadyVoted.length > 0) {
          return reply.code(409).send({ error: 'you have already voted on this gate' })
        }
        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            INSERT INTO gate_approvals (id, gate_id, tenant_id, approver_id, decision, decided_at)
            VALUES (gen_random_uuid(), ${gateId}::uuid, ${tenantId}::uuid, ${userId}::uuid, ${decision}::text, NOW())
            ON CONFLICT (gate_id, approver_id) DO NOTHING
          `
        ).catch(() => null)

        if (decision === 'approved') {
          const policies = await withTenant(prisma, tenantId, (tx) =>
            tx.$queryRaw<Array<{ scope: string; approvers_required: number }>>`
              SELECT scope, approvers_required FROM gate_policies
              WHERE tenant_id = ${tenantId}::uuid AND scope IN (${gateRows[0]!.connector_id}, ${gateRows[0]!.tool_name}, '*')
            `
          ).catch(() => [])
          const policy =
            policies.find(p => p.scope === gateRows[0]!.connector_id) ??
            policies.find(p => p.scope === gateRows[0]!.tool_name) ??
            policies.find(p => p.scope === '*')
          votesRequired = policy && policy.approvers_required > 0 ? policy.approvers_required : 1

          const countRows = await withTenant(prisma, tenantId, (tx) =>
            tx.$queryRaw<Array<{ count: bigint }>>`
              SELECT COUNT(DISTINCT approver_id) AS count FROM gate_approvals
              WHERE gate_id = ${gateId}::uuid AND decision = 'approved'
            `
          ).catch(() => [])
          votesReceived = Number(countRows[0]?.count ?? 1)
          fullyResolved = votesReceived >= votesRequired
        }
      }

      // Not enough approvals yet — gate stays 'pending', nothing downstream
      // is notified (a premature 'approved' status would let any consumer
      // polling this gate proceed before the real threshold is met).
      if (!fullyResolved) {
        gateDecisionsTotal.inc({ decision: 'partial_approval' })
        void withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            INSERT INTO audit_events (id, tenant_id, user_id, session_id, event_type, payload, created_at)
            VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
                    'gate_decision', ${JSON.stringify({ gateId, decision, votesReceived, votesRequired, mode: 'partial' })}::jsonb, NOW())
          `
        ).catch((err) => { request.log.warn({ err, gateId }, 'gate.decision audit write failed') })
        return reply.send({ ok: true, gateId, decision, fullyApproved: false, votesReceived, votesRequired })
      }

      if (redisUrl) {
        // gateRows-empty and SoD are already checked above, before any vote
        // is recorded.
        const affected = await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            UPDATE gate_events
            SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
            WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
          `
        )
        if (Number(affected) === 0) {
          return reply.code(404).send({ error: 'gate not found or already decided' })
        }
        try {
          await gateSink!.record(gateId, decision, userId)
        } catch (err) {
          request.log.warn({ err, gateId }, 'failed to publish gate decision to Redis')
        }
      } else {
        // gateRows-empty and SoD are already checked above, before any vote
        // is recorded. Persist decision to gate_events for audit trail + idempotency.
        const affected = await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            UPDATE gate_events
            SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
            WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
          `
        ).catch(() => 0)
        if (Number(affected) === 0) {
          return reply.code(404).send({ error: 'gate not found or already decided' })
        }
        await getMemoryGateSink().record(gateId, decision, userId)
      }

      gateDecisionsTotal.inc({ decision })

      // Audit every gate decision so the Audit view shows who approved/rejected what
      void withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          INSERT INTO audit_events (id, tenant_id, user_id, session_id, event_type, payload, created_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
                  'gate_decision', ${JSON.stringify({ gateId, decision, mode: redisUrl ? 'manual' : 'in-memory', toolName: gateRows[0]?.tool_name })}::jsonb, NOW())
        `
      ).catch((err) => { request.log.warn({ err, gateId }, 'gate.decision audit write failed') })

      // pipeline_rollback has no real auto-execution path (see pipeline.ts's
      // removed runRollback — it was dead code and its terraform invocation
      // was invalid even if it had been reachable). Approving this gate only
      // ever updated its DB status; the response must say so honestly
      // instead of implying a rollback actually ran.
      if (decision === 'approved' && gateRows.length > 0 && gateRows[0]!.tool_name === 'pipeline_rollback') {
        return {
          ok: true, gateId, decision, executed: false,
          note: 'Rollback approval recorded, but automatic execution is not implemented — re-deploy the previous known-good version manually.',
        }
      }

      // If the gate was approved AND this is a trigger action, dispatch to executor
      if (decision === 'approved' && gateRows.length > 0) {
        const toolName = gateRows[0]!.tool_name
        if (TRIGGER_ACTION_TYPES.has(toolName)) {
          const toolArgs = (gateRows[0]!.tool_args ?? {}) as Record<string, unknown>
          void executeTriggerAction(tenantId, {
            type: toolName as 'notify_oncall' | 'create_incident' | 'surface_context' | 'run_runbook' | 'notify_channel' | 'escalate' | 'block_deploy_gate' | 'open_war_room',
            params: toolArgs,
          }).then((result) => {
            if (result.ok) {
              request.log.info({ gateId, action: toolName, result }, 'trigger_action_executed')
            } else {
              request.log.warn({ gateId, action: toolName, result }, 'trigger_action_failed')
            }
          }).catch((err) => {
            request.log.error({ err, gateId, action: toolName }, 'trigger_action_dispatch_error')
          })
        }
      }

      return { ok: true, gateId, decision, fullyApproved: decision === 'approved', votesReceived, votesRequired }
    },
  )

  // Create a gate (admin/sre only — prevents unprivileged auto-approval forgery)
  app.post<{ Body: { action: string; target: string; requestedBy?: string; scope?: string; confidence?: number } }>(
    '/api/gate',
    {
      preHandler: [app.authenticate, requireRole('admin', 'sre')],
      schema: {
        body: {
          type: 'object',
          required: ['action', 'target'],
          properties: {
            action: { type: 'string' },
            target: { type: 'string' },
            requestedBy: { type: 'string' },
            scope: { type: 'string' },
            confidence: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => {
      const { action, target, requestedBy, scope, confidence } = request.body
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const toolArgs = JSON.stringify({ target, requestedBy: requestedBy ?? 'system' })

      // P3 policy enforcement: auto-approve when a gate policy for the action's
      // scope (or '*') sets auto_approve_threshold > 0 and the supplied
      // confidence meets it. Otherwise seed 'pending' as before.
      let status: 'pending' | 'approved' = 'pending'
      let autoApproved = false
      if (typeof confidence === 'number') {
        const lookupScope = typeof scope === 'string' && scope.length > 0 ? scope : '*'
        const policies = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ scope: string; auto_approve_threshold: number }>>`
            SELECT scope, auto_approve_threshold
            FROM gate_policies
            WHERE tenant_id = ${tenantId}::uuid AND scope IN (${lookupScope}, '*')
          `
        ).catch(() => [])
        // Prefer an exact scope match over the wildcard.
        const policy =
          policies.find((p) => p.scope === lookupScope) ?? policies.find((p) => p.scope === '*')
        if (policy && policy.auto_approve_threshold > 0 && confidence >= policy.auto_approve_threshold) {
          status = 'approved'
          autoApproved = true
        }
      }

      const systemSentinel = '00000000-0000-0000-0000-000000000000'
      const connectorId = resolveConnectorId(action, scope)
      const row = await withTenant(prisma, tenantId, (tx) =>
        autoApproved
          ? tx.$queryRaw<Array<{ id: string }>>`
              INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, created_at, decided_by, decided_at)
              VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
                      ${action}, ${toolArgs}::jsonb, ${connectorId}, ${status}::text, NOW(), ${systemSentinel}::uuid, NOW())
              RETURNING id
            `
          : tx.$queryRaw<Array<{ id: string }>>`
              INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, created_at)
              VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
                      ${action}, ${toolArgs}::jsonb, ${connectorId}, ${status}::text, NOW())
              RETURNING id
            `
      )
      return reply.code(201).send({ ok: true, id: (row as Array<{ id: string }>)[0]?.id, autoApproved })
    },
  )
}
