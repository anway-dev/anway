import { PrismaClient, Prisma } from '@prisma/client'
import { withTenant } from '../db/prisma.js'

// Change Timeline — a unified, timestamped stream of everything that changed
// (deploys, alerts, incidents, executed write actions), assembled from real
// sources. This is the substrate for counterfactual reasoning: "what changed
// before X broke?" The orchestrator reads it via the get_change_timeline tool;
// the War Room renders it scoped to an incident's service + pre-incident window.

export interface ChangeEvent {
  at: string                 // ISO timestamp
  kind: 'deploy' | 'alert' | 'incident_opened' | 'incident_resolved' | 'action' | 'pr' | 'event'
  source: string             // connector / system
  title: string
  detail?: string
  service?: string | null
  ref?: string | null        // id/sha for follow-up
}

export interface TimelineQuery {
  from?: Date
  to?: Date
  service?: string
  limit?: number
}

const CHANNEL_KIND: Record<string, ChangeEvent['kind']> = {
  alert_fired: 'alert',
  incident_created: 'incident_opened',
  deploy_completed: 'deploy',
  deploy_failed: 'deploy',
  pr_merged: 'pr',
}

export class TimelineService {
  constructor(private readonly prisma: PrismaClient) {}

  async getTimeline(tenantId: string, q: TimelineQuery = {}): Promise<ChangeEvent[]> {
    const to = q.to ?? new Date()
    const from = q.from ?? new Date(to.getTime() - 24 * 3600 * 1000)
    const limit = Math.min(q.limit ?? 200, 1000)
    const svc = q.service?.trim() || null
    const like = svc ? `%${svc}%` : null

    return withTenant(this.prisma, tenantId, async (tx) => {
      // 1. Connector events (deploys, alerts, PRs, incident_created)
      const events = await tx.$queryRaw<Array<{ channel: string; payload: unknown; created_at: Date }>>`
        SELECT channel, payload, created_at FROM event_log
        WHERE tenant_id = ${tenantId}::uuid AND created_at BETWEEN ${from} AND ${to}
          ${like ? Prisma.sql`AND payload::text ILIKE ${like}` : Prisma.empty}
        ORDER BY created_at DESC LIMIT ${limit}
      `.catch(() => [] as Array<{ channel: string; payload: unknown; created_at: Date }>)

      // 2. Incidents — opened and resolved are distinct timeline points
      const incidents = await tx.$queryRaw<Array<{ id: string; title: string; service: string | null; severity: string; created_at: Date; resolved_at: Date | null }>>`
        SELECT id, title, service, severity::text AS severity, created_at, resolved_at FROM incidents
        WHERE tenant_id = ${tenantId}::uuid
          AND (created_at BETWEEN ${from} AND ${to} OR resolved_at BETWEEN ${from} AND ${to})
          ${like ? Prisma.sql`AND (service ILIKE ${like} OR title ILIKE ${like})` : Prisma.empty}
        ORDER BY created_at DESC LIMIT ${limit}
      `.catch(() => [])

      // 3. Executed write actions (approved gate events)
      const actions = await tx.$queryRaw<Array<{ id: string; tool_name: string; connector_id: string; created_at: Date }>>`
        SELECT id, tool_name, connector_id, created_at FROM gate_events
        WHERE tenant_id = ${tenantId}::uuid AND status = 'approved'
          AND created_at BETWEEN ${from} AND ${to}
          ${like ? Prisma.sql`AND (tool_args::text ILIKE ${like} OR connector_id ILIKE ${like})` : Prisma.empty}
        ORDER BY created_at DESC LIMIT ${limit}
      `.catch(() => [] as Array<{ id: string; tool_name: string; connector_id: string; created_at: Date }>)

      const out: ChangeEvent[] = []

      for (const e of events) {
        const p = (e.payload ?? {}) as Record<string, unknown>
        const service = (p['service'] ?? p['serviceHint'] ?? null) as string | null
        const title = (p['title'] ?? p['alertname'] ?? e.channel.replace(/_/g, ' ')) as string
        out.push({
          at: e.created_at.toISOString(),
          kind: CHANNEL_KIND[e.channel] ?? 'event',
          source: 'connector',
          title,
          detail: (p['description'] ?? p['sha'] ?? undefined) as string | undefined,
          service,
        })
      }

      for (const i of incidents) {
        if (i.created_at >= from && i.created_at <= to) {
          out.push({ at: i.created_at.toISOString(), kind: 'incident_opened', source: 'anway', title: i.title, detail: i.severity, service: i.service, ref: i.id })
        }
        if (i.resolved_at && i.resolved_at >= from && i.resolved_at <= to) {
          out.push({ at: i.resolved_at.toISOString(), kind: 'incident_resolved', source: 'anway', title: `Resolved: ${i.title}`, service: i.service, ref: i.id })
        }
      }

      for (const a of actions) {
        out.push({ at: a.created_at.toISOString(), kind: 'action', source: a.connector_id, title: a.tool_name, detail: 'approved write action', ref: a.id })
      }

      out.sort((x, y) => y.at.localeCompare(x.at))
      return out.slice(0, limit)
    })
  }
}
