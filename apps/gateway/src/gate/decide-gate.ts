import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { RedisGateSink } from './redis-gate-sink.js'
import { getMemoryGateSink } from './memory-gate-fallback.js'
import { gateDecisionsTotal } from '../metrics.js'
import { executeTriggerAction } from '../triggers/actions.js'
import type { TriggerAction } from '../triggers/engine.js'
import { executePipelineRollback } from '../pipeline/rollback.js'

const TRIGGER_ACTION_TYPES = new Set([
  'notify_oncall', 'create_incident', 'run_runbook', 'notify_channel',
  'escalate', 'block_deploy_gate', 'open_war_room', 'surface_context',
  // generic primitives
  'http_request', 'db_op', 'emit_event',
])

const redisUrl = process.env['REDIS_URL']
const gateSink = redisUrl ? new RedisGateSink(redisUrl) : null

export interface DecideGateResult {
  ok: boolean
  code: 400 | 403 | 404 | 409 | 200
  error?: string
  gateId?: string
  decision?: 'approved' | 'rejected'
  fullyApproved?: boolean
  votesReceived?: number
  votesRequired?: number
  executed?: boolean
  note?: string
}

/**
 * Single source of truth for resolving a gate decision — SoD check,
 * multi-approver vote counting against gate_policies.approvers_required,
 * persistence (Redis or in-memory sink), audit logging, and trigger-action
 * dispatch on approval. Shared by the dedicated `/api/gate/:gateId/decide`
 * route (role-gated by its own preHandler) and the `approve_gate` chat tool
 * (role-gated by its caller) — confirmed live via independent review that
 * the chat tool previously duplicated a simplified, diverging version of
 * this logic with no role check, no multi-approver enforcement, and no
 * audit trail. One implementation now, so both paths can never drift.
 */
export async function decideGate(
  tenantId: string,
  userId: string,
  gateId: string,
  decision: 'approved' | 'rejected',
  log?: { warn: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void },
): Promise<DecideGateResult> {
  const gateRows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ user_id: string; tool_name: string; tool_args: Record<string, unknown> | null; connector_id: string }>>`
      SELECT user_id, tool_name, tool_args, connector_id FROM gate_events
      WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending' LIMIT 1
    `
  ).catch(() => [] as Array<{ user_id: string; tool_name: string; tool_args: Record<string, unknown> | null; connector_id: string }>)

  if (gateRows.length === 0) {
    return { ok: false, code: 404, error: 'gate not found or already decided' }
  }
  if (gateRows[0]!.user_id === userId) {
    return { ok: false, code: 403, error: 'cannot approve your own gate request' }
  }

  let fullyResolved = decision === 'rejected'
  let votesReceived = 0
  let votesRequired = 1

  const alreadyVoted = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM gate_approvals WHERE gate_id = ${gateId}::uuid AND approver_id = ${userId}::uuid LIMIT 1
    `
  ).catch(() => [])
  if (alreadyVoted.length > 0) {
    return { ok: false, code: 409, error: 'you have already voted on this gate' }
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

  if (!fullyResolved) {
    gateDecisionsTotal.inc({ decision: 'partial_approval' })
    void withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`
        INSERT INTO audit_events (id, tenant_id, user_id, session_id, event_type, payload, created_at)
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
                'gate_decision', ${JSON.stringify({ gateId, decision, votesReceived, votesRequired, mode: 'partial' })}::jsonb, NOW())
      `
    ).catch((err) => { log?.warn({ err, gateId }, 'gate.decision audit write failed') })
    return { ok: true, code: 200, gateId, decision, fullyApproved: false, votesReceived, votesRequired }
  }

  if (redisUrl) {
    const affected = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE gate_events
        SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
        WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
      `
    )
    if (Number(affected) === 0) {
      return { ok: false, code: 404, error: 'gate not found or already decided' }
    }
    try {
      await gateSink!.record(gateId, decision, userId)
    } catch (err) {
      log?.warn({ err, gateId }, 'failed to publish gate decision to Redis')
    }
  } else {
    const affected = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE gate_events
        SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
        WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
      `
    ).catch(() => 0)
    if (Number(affected) === 0) {
      return { ok: false, code: 404, error: 'gate not found or already decided' }
    }
    await getMemoryGateSink().record(gateId, decision, userId)
  }

  gateDecisionsTotal.inc({ decision })

  void withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw`
      INSERT INTO audit_events (id, tenant_id, user_id, session_id, event_type, payload, created_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
              'gate_decision', ${JSON.stringify({ gateId, decision, mode: redisUrl ? 'manual' : 'in-memory', toolName: gateRows[0]?.tool_name })}::jsonb, NOW())
    `
  ).catch((err) => { log?.warn({ err, gateId }, 'gate.decision audit write failed') })

  if (decision === 'approved' && gateRows[0]!.tool_name === 'pipeline_rollback') {
    // Real execution — helm's native rollback to the previous release
    // revision (pipeline/rollback.ts). Fired async: `helm rollback --wait`
    // can take minutes and this function's result is returned synchronously
    // to the approving HTTP request / chat tool. Outcome lands on the
    // pipeline's own rollback stage run + audit log either way.
    const toolArgs = (gateRows[0]!.tool_args ?? {}) as Record<string, unknown>
    const pipelineId = toolArgs['pipelineId'] as string | undefined
    if (pipelineId) {
      void executePipelineRollback(tenantId, pipelineId, userId)
        .then((r) => log?.info({ gateId, pipelineId, ok: r.ok }, 'pipeline rollback finished'))
        .catch((err) => log?.error({ err, gateId, pipelineId }, 'pipeline rollback dispatch error'))
      return {
        ok: true, code: 200, gateId, decision, executed: true,
        note: 'Rollback execution started (helm rollback to previous revision) — outcome will appear on the pipeline rollback stage and audit log.',
      }
    }
    return {
      ok: true, code: 200, gateId, decision, executed: false,
      note: 'Rollback approved but the gate carries no pipelineId — cannot resolve which release to roll back.',
    }
  }

  if (decision === 'approved') {
    const toolName = gateRows[0]!.tool_name
    if (TRIGGER_ACTION_TYPES.has(toolName)) {
      const toolArgs = (gateRows[0]!.tool_args ?? {}) as Record<string, unknown>
      void executeTriggerAction(tenantId, {
        type: toolName as TriggerAction['type'],
        params: toolArgs,
      }).then((result) => {
        if (result.ok) {
          log?.info({ gateId, action: toolName, result }, 'trigger_action_executed')
        } else {
          log?.warn({ gateId, action: toolName, result }, 'trigger_action_failed')
        }
      }).catch((err) => {
        log?.error({ err, gateId, action: toolName }, 'trigger_action_dispatch_error')
      })
    }
  }

  return { ok: true, code: 200, gateId, decision, fullyApproved: decision === 'approved', votesReceived, votesRequired }
}
