import { requireRole } from '../plugins/rbac.js'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { appendAuditEvent } from './audit.js'
import { TriggerEngine } from '../triggers/engine.js'
import { resolveTemplates } from '../triggers/template.js'
import type { TriggerAction, TriggerRule } from '../triggers/engine.js'
import { getActiveScheduler, registerUserMonitor, MONITOR_IMPLS } from '../jobs/scheduler.js'
import { UUID_RE } from '../utils/validators.js'

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
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
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
                type: { type: 'string', enum: ['notify_oncall', 'create_incident', 'surface_context', 'run_runbook', 'notify_channel', 'escalate', 'block_deploy_gate', 'open_war_room', 'http_request', 'db_op', 'emit_event'] },
                params: { type: 'object' },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
  }, async (request) => {
    const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
    const { eventType, condition, actions } = request.body
    // Load creating user's perimeter to store as trigger perimeter scope
    const userPerimeterRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_name: string; read_scopes: string[]; write_scopes: string[] }[]>`
        SELECT connector_name, read_scopes, write_scopes FROM user_perimeters
        WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid
      `
    ).catch(() => [] as { connector_name: string; read_scopes: string[]; write_scopes: string[] }[])
    const perimeter = userPerimeterRows.length > 0
      ? userPerimeterRows.map(r => ({
          connectorId: r.connector_name,
          read: r.read_scopes,
          write: r.write_scopes,
        }))
      : null
    const rule = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<TriggerRule[]>`
        INSERT INTO trigger_rules (tenant_id, event_type, condition, actions, perimeter)
        VALUES (${tenantId}::uuid, ${eventType}, ${JSON.stringify(condition ?? {})}::jsonb, ${JSON.stringify(actions)}::jsonb, ${perimeter ? JSON.stringify(perimeter) : null}::jsonb)
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
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
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
    const { actions } = await engine.evaluate(eventType, payload)
    // Resolve {{ payload.* }} templates so the preview shows the real params
    // that would run — same resolution the executor applies before the gate.
    const resolved = actions.map((a) => ({ ...a, params: resolveTemplates(a.params, payload) }))
    return { matched: resolved.length, actions: resolved }
  })

  app.patch<{ Params: { id: string }; Body: Partial<{ enabled: boolean; condition: Record<string, unknown>; actions: TriggerAction[] }> }>('/api/automations/triggers/:id', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          condition: { type: 'object' },
          actions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['type'],
              additionalProperties: false,
              properties: {
                type: { type: 'string', enum: ['notify_oncall', 'create_incident', 'surface_context', 'run_runbook', 'notify_channel', 'escalate', 'block_deploy_gate', 'open_war_room', 'http_request', 'db_op', 'emit_event'] },
                params: { type: 'object' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
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
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
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
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'schedule', 'jobType'],
        properties: {
          name: { type: 'string', minLength: 1 },
          schedule: { type: 'string', minLength: 1 },
          // Only job types with real implementations are creatable — see MONITOR_IMPLS
          jobType: { type: 'string', enum: ['service_health_sweep', 'slo_burn_check', 'deploy_health_report', 'oncall_morning_brief', 'cloud_security_scan', 'cost_anomaly_detection', 'incident_retrospective', 'data_retention'] },
        },
      },
    },
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { name, schedule, jobType } = request.body
    if (!/^(\S+ ){4}\S+$/.test(schedule)) {
      return reply.code(400).send({ error: 'invalid schedule — must be a 5-field cron expression' })
    }
    if (!MONITOR_IMPLS[jobType]) {
      return reply.code(400).send({ error: `unsupported jobType: ${jobType}` })
    }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO cron_jobs (tenant_id, name, schedule, job_type, enabled)
        VALUES (${tenantId}::uuid, ${name}, ${schedule}, ${jobType}, true)
        RETURNING id
      `
    )
    const id = (rows as Array<{ id: string }>)[0]?.id
    // Schedule immediately — no gateway restart needed
    const scheduler = getActiveScheduler()
    if (scheduler && id) {
      await registerUserMonitor(scheduler, { id, tenant_id: tenantId, name, schedule, job_type: jobType })
        .catch((err) => request.log.warn({ err, id }, 'monitor created but scheduling failed — will register on next restart'))
    }
    return { ok: true, id, name, schedule, jobType }
  })

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>('/api/automations/monitors/:id', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`UPDATE cron_jobs SET enabled = ${request.body.enabled} WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
    )
    return { updated: true }
  })

  app.delete<{ Params: { id: string } }>('/api/automations/monitors/:id', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
  }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM cron_jobs WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid RETURNING id
      `
    ).catch(() => [] as Array<{ id: string }>)
    if (rows.length === 0) return reply.code(404).send({ error: 'not found' })
    await appendAuditEvent({
      tenantId, userId,
      action: 'monitor.delete',
      resource: `monitor:${id}`,
      outcome: 'action_executed',
      metadata: { id },
    }).catch(() => {})
    return reply.send({ deleted: true, id })
  })

  app.get<{ Params: { id: string } }>('/api/triggers/:id/runs', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) { reply.code(400); return { error: 'invalid id' } }
    const runs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`
        SELECT id, status, summary, started_at AS "startedAt", finished_at AS "finishedAt"
        FROM automation_runs
        WHERE tenant_id = ${tenantId}::uuid AND kind = 'trigger' AND ref_id = ${id}::uuid
        ORDER BY started_at DESC
        LIMIT 20
      `
    ).catch(() => [])
    return { runs }
  })

  app.get<{ Params: { id: string } }>('/api/cron/:id/runs', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { id } = request.params
    if (!UUID_RE.test(id)) { reply.code(400); return { error: 'invalid id' } }
    const runs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`
        SELECT id, status, summary, started_at AS "startedAt", finished_at AS "finishedAt"
        FROM automation_runs
        WHERE tenant_id = ${tenantId}::uuid AND kind = 'cron' AND ref_id = ${id}::uuid
        ORDER BY started_at DESC
        LIMIT 20
      `
    )
    return { runs }
  })
}
