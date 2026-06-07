import type { FastifyInstance } from 'fastify'
import { TriggerEngine } from '../triggers/engine.js'
import type { TriggerRule, TriggerAction } from '../triggers/engine.js'

const engine = new TriggerEngine()
const activeTriggers: TriggerRule[] = []

export async function automationsRoutes(app: FastifyInstance) {
  app.get('/api/automations/triggers', {
    preHandler: [app.authenticate],
  }, async () => {
    return activeTriggers.map(t => ({
      id: t.id,
      eventType: t.eventType,
      enabled: t.enabled,
      actionCount: t.actions.length,
    }))
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
    const rule: TriggerRule = {
      id: `trigger-${Date.now()}`,
      tenantId,
      eventType,
      condition: condition ?? {},
      actions,
      enabled: true,
    }
    activeTriggers.push(rule)
    engine.loadRules(activeTriggers)
    return rule
  })

  app.post<{ Body: { eventType: string; payload: Record<string, unknown> } }>('/api/automations/evaluate', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { eventType, payload } = request.body
    const actions = await engine.evaluate(eventType, payload)
    return { matched: actions.length, actions }
  })
}
