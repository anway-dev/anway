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
          actions: { type: 'array' },
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
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`UPDATE trigger_rules SET enabled = ${enabled} WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
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
}
