import { createClient } from 'redis'
import type { TriggerAction } from './engine.js'
import pino from 'pino'

const log = pino({ name: 'trigger-executor' })

export async function startTriggerExecutor(redisUrl: string): Promise<void> {
  const sub = createClient({ url: redisUrl })
  const pub = createClient({ url: redisUrl })
  await Promise.all([sub.connect(), pub.connect()])

  await sub.subscribe('trigger_matched', async (message) => {
    let payload: { tenantId: string; channel: string; eventType?: string; actions: TriggerAction[] }
    try { payload = JSON.parse(message) } catch { return }

    for (const action of payload.actions) {
      // V1: ALL write actions require gate — surface to UI, do not auto-execute
      if (['notify_oncall', 'create_incident', 'run_runbook'].includes(action.type)) {
        await pub.publish('trigger_gate_required', JSON.stringify({
          tenantId: payload.tenantId,
          action,
          createdAt: new Date().toISOString(),
        }))
        log.info({ action: action.type, tenantId: payload.tenantId }, 'trigger action pending gate approval')
        continue
      }
      // Read-only actions (surface_context) execute immediately
      if (action.type === 'surface_context') {
        await pub.publish('session:context', JSON.stringify({
          tenantId: payload.tenantId,
          context: { eventType: payload.eventType ?? 'unknown', payload },
        })).catch(() => {})
        log.info({ tenantId: payload.tenantId }, 'surface_context triggered')
      }
    }
  })
  log.info('TriggerExecutor started')
}
