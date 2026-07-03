import { createClient } from 'redis'
import type { TriggerAction, TriggerPerimeter } from './engine.js'
import { executeTriggerAction } from './actions.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import pino from 'pino'

const log = pino({ name: 'trigger-executor' })

const WRITE_ACTIONS = new Set([
  'notify_oncall', 'create_incident', 'run_runbook', 'notify_channel',
  'escalate', 'block_deploy_gate', 'open_war_room',
])

function perimeterAllows(perimeters: TriggerPerimeter[], action: TriggerAction): boolean {
  if (perimeters.length === 0) return true // backward compat — no perimeter = no restriction
  const isWrite = WRITE_ACTIONS.has(action.type)
  return perimeters.some(p => isWrite ? p.write.length > 0 : p.read.length > 0)
}

export async function startTriggerExecutor(redisUrl: string): Promise<void> {
  const sub = createClient({ url: redisUrl })
  await sub.connect()

  await sub.subscribe('trigger_matched', async (message) => {
    let payload: {
      tenantId: string
      channel: string
      eventType?: string
      actions: TriggerAction[]
      perimeters?: TriggerPerimeter[]
    }
    try { payload = JSON.parse(message) } catch { return }

    const perimeters = payload.perimeters ?? []
    const systemSentinel = '00000000-0000-0000-0000-000000000000'

    for (const action of payload.actions) {
      if (perimeters.length > 0 && !perimeterAllows(perimeters, action)) {
        log.warn({ action: action.type, tenantId: payload.tenantId }, 'trigger action blocked by perimeter')
        continue
      }

      // V1: ALL write actions require gate approval — insert a real gate_events row
      // so it shows up in /api/gate/pending and the Approvals UI.
      if (WRITE_ACTIONS.has(action.type)) {
        const toolArgs = JSON.stringify(action.params)
        const connectorType = actionTypeToConnector(action.type)

        try {
          const rows = await withTenant(prisma, payload.tenantId, (tx) =>
            tx.$queryRaw<Array<{ id: string }>>`
              INSERT INTO gate_events (id, tenant_id, user_id, session_id,
                tool_name, tool_args, connector_id, status, created_at)
              VALUES (gen_random_uuid(), ${payload.tenantId}::uuid,
                ${systemSentinel}::uuid, gen_random_uuid(),
                ${action.type}, ${toolArgs}::jsonb, ${connectorType},
                'pending', NOW())
              RETURNING id
            `
          )
          const gateId = rows[0]?.id
          log.info({ action: action.type, tenantId: payload.tenantId, gateId }, 'trigger write action pending gate approval — gate_events row inserted')

          // Still publish trigger_gate_required for any future consumer
          await sub.publish('trigger_gate_required', JSON.stringify({
            tenantId: payload.tenantId,
            gateId,
            action,
            createdAt: new Date().toISOString(),
          })).catch(() => {})
        } catch (err) {
          log.error({ err, action: action.type, tenantId: payload.tenantId }, 'failed to insert gate_events row for trigger action')
        }
        continue
      }

      // Read-only actions (surface_context) execute immediately
      if (action.type === 'surface_context') {
        try {
          const result = await executeTriggerAction(payload.tenantId, action)
          log.info({ tenantId: payload.tenantId, result }, 'surface_context executed')
        } catch (err) {
          log.error({ err, tenantId: payload.tenantId }, 'surface_context execution failed')
        }
      }
    }
  })
  log.info('TriggerExecutor started')
}

/** Maps a trigger action type to a representative connector type for gate_events visibility. */
function actionTypeToConnector(actionType: string): string {
  switch (actionType) {
    case 'notify_channel': return 'slack'
    case 'notify_oncall':
    case 'escalate':       return 'pagerduty'
    case 'block_deploy_gate': return 'argocd'
    default:               return 'trigger-system'
  }
}
