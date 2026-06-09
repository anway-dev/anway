import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { TriggerEngine } from '../triggers/engine.js'
import type { TriggerAction, TriggerRule } from '../triggers/engine.js'

export async function automationsRoutes(app: FastifyInstance) {
  app.get('/api/automations/triggers', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rules = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<TriggerRule[]>`
        SELECT
          id,
          tenant_id     AS "tenantId",
          event_type    AS "eventType",
          condition,
          actions,
          enabled,
          created_at    AS "createdAt"
        FROM trigger_rules
        WHERE tenant_id = ${tenantId}::uuid AND enabled = true
      `
    )
    return rules
  })

  app.post<{ Body: { eventType: string; condition: Record<string, unknown>; actions: TriggerAction[] } }>('/api/automations/triggers', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['eventType', 'actions'],
        properties: {
          eventType: { type: 'string' },
          condition: { type: 'object' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: { type: 'string', enum: ['notify_oncall', 'create_incident', 'surface_context', 'run_runbook', 'notify_channel', 'escalate', 'block_deploy_gate'] },
                params: { type: 'object' },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { eventType, condition, actions } = request.body
    const rule = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<TriggerRule[]>`
        INSERT INTO trigger_rules (tenant_id, event_type, condition, actions)
        VALUES (${tenantId}::uuid, ${eventType}, ${JSON.stringify(condition ?? {})}::jsonb, ${JSON.stringify(actions)}::jsonb)
        RETURNING
          id,
          tenant_id     AS "tenantId",
          event_type    AS "eventType",
          condition,
          actions,
          enabled,
          created_at    AS "createdAt"
      `
    )
    return rule
  })

  app.post<{ Body: { eventType: string; payload: Record<string, unknown> } }>('/api/automations/evaluate', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { eventType, payload } = request.body
    const rules = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<TriggerRule[]>`
        SELECT
          id,
          tenant_id     AS "tenantId",
          event_type    AS "eventType",
          condition,
          actions,
          enabled,
          created_at    AS "createdAt"
        FROM trigger_rules
        WHERE tenant_id = ${tenantId}::uuid AND enabled = true
      `
    )
    const engine = new TriggerEngine()
    engine.loadRules(rules)
    const actions = await engine.evaluate(eventType, payload)
    return { matched: actions.length, actions }
  })

  app.patch<{ Params: { id: string }; Body: Partial<{ enabled: boolean; condition: Record<string, unknown>; actions: TriggerAction[] }> }>('/api/automations/triggers/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    const { enabled, condition, actions } = request.body
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1
    if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(enabled) }
    if (condition !== undefined) { sets.push(`condition = $${idx++}::jsonb`); params.push(JSON.stringify(condition)) }
    if (actions !== undefined) { sets.push(`actions = $${idx++}::jsonb`); params.push(JSON.stringify(actions)) }
    if (sets.length === 0) return { updated: false }
    params.push(id, tenantId)
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRawUnsafe(`UPDATE trigger_rules SET ${sets.join(', ')} WHERE id = $${idx}::uuid AND tenant_id = $${idx + 1}::uuid`, ...params)
    )
    return { updated: true }
  })

  app.delete<{ Params: { id: string } }>('/api/automations/triggers/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`DELETE FROM trigger_rules WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
    )
    return { deleted: true }
  })

  app.get('/api/automations/monitors', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    return withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`
        SELECT id, name, schedule, job_type AS "jobType", enabled, last_run_at AS "lastRunAt", last_result AS "lastResult"
        FROM cron_jobs WHERE tenant_id = ${tenantId}::uuid ORDER BY name
      `
    )
  })

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>('/api/automations/monitors/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`UPDATE cron_jobs SET enabled = ${request.body.enabled} WHERE id = ${request.params.id}::uuid AND tenant_id = ${tenantId}::uuid`
    )
    return { updated: true }
  })

  // T8: Trigger run history — mock data for now
  app.get<{ Params: { id: string } }>('/api/triggers/:id/runs', {
    preHandler: [app.authenticate],
  }, async () => ({
    runs: [
      { event: 'alert_fired', timestamp: new Date(Date.now() - 3_600_000).toISOString(), actions: ['create_incident', 'notify_oncall'], result: 'success' },
      { event: 'deploy_failed', timestamp: new Date(Date.now() - 7_200_000).toISOString(), actions: ['surface_context'], result: 'success' },
      { event: 'error_rate_threshold', timestamp: new Date(Date.now() - 14_400_000).toISOString(), actions: ['create_incident'], result: 'error: incident already exists' },
    ],
  }))

  // T8: Cron run history — mock data for now
  app.get<{ Params: { id: string } }>('/api/cron/:id/runs', {
    preHandler: [app.authenticate],
  }, async () => ({
    runs: [
      { started_at: new Date(Date.now() - 300_000).toISOString(), duration_ms: 1200, anomaly_found: false, summary: 'All services healthy' },
      { started_at: new Date(Date.now() - 600_000).toISOString(), duration_ms: 980, anomaly_found: false, summary: 'All services healthy' },
      { started_at: new Date(Date.now() - 900_000).toISOString(), duration_ms: 1500, anomaly_found: true, summary: 'payments-api p99 elevated' },
    ],
  }))
}
