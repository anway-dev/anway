import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { TriggerEngine } from '../triggers/engine.js'
import type { TriggerAction } from '../triggers/engine.js'

export async function automationsRoutes(app: FastifyInstance) {
  app.get('/api/automations/triggers', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rules = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`SELECT * FROM trigger_rules WHERE tenant_id = ${tenantId}::uuid AND enabled = true`
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
      tx.$queryRaw`
        INSERT INTO trigger_rules (tenant_id, event_type, condition, actions)
        VALUES (${tenantId}::uuid, ${eventType}, ${JSON.stringify(condition ?? {})}::jsonb, ${JSON.stringify(actions)}::jsonb)
        RETURNING *
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
      tx.$queryRaw`SELECT * FROM trigger_rules WHERE tenant_id = ${tenantId}::uuid AND enabled = true`
    )
    const engine = new TriggerEngine()
    engine.loadRules(rules as any[])
    const actions = await engine.evaluate(eventType, payload)
    return { matched: actions.length, actions }
  })
}
