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
            minItems: 1,
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
  }, async (request, reply) => {
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
    const sql = `UPDATE trigger_rules SET ${sets.join(', ')} WHERE id = $${idx}::uuid AND tenant_id = $${idx + 1}::uuid`
    const result = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRawUnsafe(sql, ...params)
    )
    // $executeRawUnsafe returns number of rows affected
    if (result === 0) { reply.code(404); return { error: 'Trigger not found' } }
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

  app.post<{ Body: { name: string; schedule: string; jobType: string } }>('/api/automations/monitors', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'schedule', 'jobType'],
        properties: {
          name: { type: 'string', minLength: 1 },
          schedule: { type: 'string', minLength: 1 },
          jobType: { type: 'string', enum: ['service_health_sweep', 'cloud_security_scan', 'slo_burn_check', 'cost_anomaly_detection', 'deploy_health_report', 'oncall_morning_brief', 'incident_retrospective'] },
        },
      },
    },
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { name, schedule, jobType } = request.body
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO cron_jobs (tenant_id, name, schedule, job_type, enabled)
        VALUES (${tenantId}::uuid, ${name}, ${schedule}, ${jobType}, true)
        RETURNING id
      `
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    return { ok: true, id, name, schedule, jobType }
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
    runs: [],
  }))

  app.get<{ Params: { id: string } }>('/api/cron/:id/runs', {
    preHandler: [app.authenticate],
  }, async () => ({
    runs: [],
  }))
}
