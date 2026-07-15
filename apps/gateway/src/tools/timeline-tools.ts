import type { ExecutableTool } from '@anway/agent'
import { prisma } from '../db/client.js'
import { TimelineService } from '../services/timeline.js'

// Read-only harness tool: exposes the Change Timeline to the orchestrator so it
// can reason counterfactually ("the deploy at 14:32 preceded the alert at 14:35
// — likely cause"). Grounded in real event_log / incidents / gate_events rows,
// never invented. Bare-named — must be in the perimeter builtins allowlist.
export function makeTimelineTools(tenantId: string): ExecutableTool[] {
  const svc = new TimelineService(prisma)
  return [
    {
      name: 'get_change_timeline',
      description: 'Get a chronological timeline of everything that changed (deploys, alerts, incidents, executed write actions) in a time window, optionally scoped to one service. Use to answer "what changed before X broke?" and to reason about likely cause. Returns real, timestamped, grounded events — never speculation.',
      parameters: {
        type: 'object' as const,
        properties: {
          service: { type: 'string', description: 'Optional service name to scope to (e.g. "payments-api").' },
          hoursBack: { type: 'number', description: 'How many hours back from now (or from `before`) to include. Default 24.' },
          before: { type: 'string', description: 'Optional ISO timestamp — return changes up to this moment (e.g. an incident start time). Defaults to now.' },
        },
      },
      async run(args: Record<string, unknown>) {
        const to = args['before'] ? new Date(args['before'] as string) : new Date()
        const hours = typeof args['hoursBack'] === 'number' ? (args['hoursBack'] as number) : 24
        const from = new Date(to.getTime() - hours * 3600 * 1000)
        const service = (args['service'] as string | undefined) ?? undefined
        const events = await svc.getTimeline(tenantId, { from, to, service, limit: 200 })
        return { window: { from: from.toISOString(), to: to.toISOString() }, service: service ?? null, count: events.length, events }
      },
    },
  ]
}
