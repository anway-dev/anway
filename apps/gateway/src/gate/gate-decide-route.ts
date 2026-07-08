import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { UUID_RE } from '../utils/validators.js'
import { requireRole } from '../plugins/rbac.js'
import { decideGate } from './decide-gate.js'

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

      const result = await decideGate(tenantId, userId, gateId, decision, request.log)
      if (!result.ok) {
        return reply.code(result.code).send({ error: result.error })
      }
      return reply.code(result.code).send(result)
    },
  )

  // Create a gate — admin/sre/dev. Confirmed live via independent review:
  // this was admin/sre only, but editor.commit (the only execution route a
  // dev-role user can ever reach) also requires an approved gate — meaning
  // a dev user editing code had no way to even REQUEST the approval their
  // own commit needed, a structural dead end (403 before an admin/sre ever
  // saw it). Adding 'dev' here doesn't weaken anything: approval remains
  // admin/sre-only (POST /api/gate/:gateId/decide) with SoD enforced
  // (decideGate rejects self-approval), and every execution route
  // independently re-checks its own role requirement regardless of gate
  // status — a dev-created gate for an action only admin/sre can execute
  // (k8s/ecs/terraform) is simply never consumable by that dev, not a
  // privilege escalation.
  app.post<{ Body: { action: string; target: string; requestedBy?: string; scope?: string; confidence?: number } }>(
    '/api/gate',
    {
      preHandler: [app.authenticate, requireRole('admin', 'sre', 'dev')],
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
