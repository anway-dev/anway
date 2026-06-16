import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { appendAuditEvent } from './audit.js'

interface GatePolicyRow {
  id: string
  scope: string
  approvers_required: number
  auto_approve_threshold: number
  created_at: Date
}

export async function gatePolicyRoutes(app: FastifyInstance) {
  // GET — all gate policies for the tenant
  app.get('/api/gate/policies', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<GatePolicyRow[]>`
        SELECT id, scope, approvers_required, auto_approve_threshold, created_at
        FROM gate_policies
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY scope ASC
      `
    ).catch(() => [])
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      approversRequired: r.approvers_required,
      autoApproveThreshold: r.auto_approve_threshold,
      createdAt: r.created_at,
    }))
  })

  // PUT — upsert a gate policy (admin only)
  app.put<{ Body: { scope?: string; approversRequired?: number; autoApproveThreshold?: number } }>(
    '/api/gate/policies',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string; sub: string }
      const { tenantId, sub: userId } = user
      if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })

      const { scope, approversRequired, autoApproveThreshold } = request.body
      if (typeof scope !== 'string' || scope.length === 0 || scope.length > 128) {
        return reply.code(400).send({ error: 'scope must be a non-empty string (max 128 chars)' })
      }
      if (typeof approversRequired !== 'number' || !Number.isInteger(approversRequired) || approversRequired < 1) {
        return reply.code(400).send({ error: 'approversRequired must be an integer >= 1' })
      }
      if (typeof autoApproveThreshold !== 'number' || autoApproveThreshold < 0 || autoApproveThreshold > 1) {
        return reply.code(400).send({ error: 'autoApproveThreshold must be a number between 0 and 1' })
      }
      // V1: clamp minimum threshold to 0.95 — ALL write actions require explicit human confirmation
      const clampedThreshold = Math.max(autoApproveThreshold, 0.95)

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<GatePolicyRow[]>`
          INSERT INTO gate_policies (id, tenant_id, scope, approvers_required, auto_approve_threshold, created_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${scope}, ${approversRequired}::int, ${clampedThreshold}::double precision, NOW())
          ON CONFLICT (tenant_id, scope) DO UPDATE SET
            approvers_required = EXCLUDED.approvers_required,
            auto_approve_threshold = EXCLUDED.auto_approve_threshold
          RETURNING id, scope, approvers_required, auto_approve_threshold, created_at
        `
      )
      const r = rows[0]
      if (!r) return reply.code(500).send({ error: 'upsert failed' })

      await appendAuditEvent({
        tenantId, userId: user.sub,
        action: 'gate_policy.upsert',
        resource: `gate_policy:${r.id}`,
        outcome: 'action_executed',
        metadata: { scope, approversRequired, autoApproveThreshold: clampedThreshold },
      }).catch(() => {})
      return reply.code(200).send({
        id: r.id,
        scope: r.scope,
        approversRequired: r.approvers_required,
        autoApproveThreshold: r.auto_approve_threshold,
        createdAt: r.created_at,
      })
    },
  )
}
