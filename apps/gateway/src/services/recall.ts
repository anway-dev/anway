import { PrismaClient, Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { withTenant } from '../db/prisma.js'

// Recall — institutional memory. A resolved incident becomes a recall entry
// keyed by the signal's fingerprint; a new incident with the same fingerprint
// can then be told "seen N× before, last cause X, fix Y, resolved in Z".

export interface RecallMatch {
  count: number
  lastRootCause: string | null
  lastFixAction: unknown | null
  lastTtrSeconds: number | null
  lastResolvedAt: string | null
  avgTtrSeconds: number | null
}

/**
 * Deterministic fingerprint of a signal: normalized service + alertname +
 * severity. Two incidents that are "the same kind of problem" hash equal.
 */
export function fingerprint(service: string | null | undefined, alertname: string | null | undefined, severity: string): string {
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
  return createHash('sha1').update(`${norm(service)}|${norm(alertname)}|${severity}`).digest('hex').slice(0, 16)
}

export class RecallService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Prior resolutions for this fingerprint (excluding the given incident). */
  async findMatches(tenantId: string, fp: string, excludeIncidentId?: string): Promise<RecallMatch | null> {
    const rows = await withTenant(this.prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ root_cause: string | null; fix_action: unknown; ttr_seconds: number | null; resolved_at: Date }>>`
        SELECT root_cause, fix_action, ttr_seconds, resolved_at
        FROM recall_entries
        WHERE tenant_id = ${tenantId}::uuid AND fingerprint = ${fp}
          ${excludeIncidentId ? Prisma.sql`AND (incident_id IS NULL OR incident_id <> ${excludeIncidentId}::uuid)` : Prisma.empty}
        ORDER BY resolved_at DESC LIMIT 10
      `,
    ).catch(() => [] as Array<{ root_cause: string | null; fix_action: unknown; ttr_seconds: number | null; resolved_at: Date }>)

    if (rows.length === 0) return null
    const ttrs = rows.map(r => r.ttr_seconds).filter((n): n is number => typeof n === 'number')
    const first = rows[0]!
    // An empty jsonb ({}) means "no fix captured" — normalize to null so callers
    // (and the UI's "Apply prior fix" button) don't treat it as a real action.
    const fa = first.fix_action
    const hasFix = fa && typeof fa === 'object' && Object.keys(fa as object).length > 0
    return {
      count: rows.length,
      lastRootCause: first.root_cause,
      lastFixAction: hasFix ? fa : null,
      lastTtrSeconds: first.ttr_seconds,
      lastResolvedAt: first.resolved_at.toISOString(),
      avgTtrSeconds: ttrs.length ? Math.round(ttrs.reduce((a, b) => a + b, 0) / ttrs.length) : null,
    }
  }

  /** Recall context for an existing incident (looks up its stored fingerprint). */
  async forIncident(tenantId: string, incidentId: string): Promise<RecallMatch | null> {
    const rows = await withTenant(this.prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ fingerprint: string | null; service: string | null; title: string; severity: string }>>`
        SELECT fingerprint, service, title, severity::text AS severity
        FROM incidents WHERE id = ${incidentId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
      `,
    ).catch(() => [])
    const inc = rows[0]
    if (!inc) return null
    const fp = inc.fingerprint ?? fingerprint(inc.service, inc.title, inc.severity)
    return this.findMatches(tenantId, fp, incidentId)
  }

  /** Called on incident resolve — capture this resolution as a recall entry. */
  async recordResolution(tenantId: string, incidentId: string): Promise<void> {
    const rows = await withTenant(this.prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ fingerprint: string | null; service: string | null; title: string; severity: string; suggested_root_cause: string | null; created_at: Date; resolved_at: Date | null }>>`
        SELECT fingerprint, service, title, severity::text AS severity, suggested_root_cause, created_at, resolved_at
        FROM incidents WHERE id = ${incidentId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
      `,
    ).catch(() => [])
    const inc = rows[0]
    if (!inc) return

    const fp = inc.fingerprint ?? fingerprint(inc.service, inc.title, inc.severity)
    const resolvedAt = inc.resolved_at ?? new Date()
    const ttr = Math.max(0, Math.round((resolvedAt.getTime() - inc.created_at.getTime()) / 1000))

    // Fix capture — only when we can safely correlate: a gate action APPROVED
    // during this incident's open window whose args reference this incident's
    // service. No service or no matching action → fix_action stays null (we
    // never guess which action "fixed" it; a wrong replay is worse than none).
    let fixAction: string | null = null
    if (inc.service) {
      const acts = await withTenant(this.prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ tool_name: string; tool_args: unknown; connector_id: string }>>`
          SELECT tool_name, tool_args, connector_id
          FROM gate_events
          WHERE tenant_id = ${tenantId}::uuid AND status = 'approved'
            AND created_at BETWEEN ${inc.created_at} AND ${resolvedAt}
            AND (tool_args::text ILIKE ${'%' + inc.service + '%'} OR connector_id ILIKE ${'%' + inc.service + '%'})
          ORDER BY decided_at DESC NULLS LAST LIMIT 1
        `,
      ).catch(() => [])
      const a = acts[0]
      if (a) fixAction = JSON.stringify({ toolName: a.tool_name, toolArgs: a.tool_args, connectorId: a.connector_id })
    }

    await withTenant(this.prisma, tenantId, (tx) =>
      tx.$executeRaw`
        INSERT INTO recall_entries (tenant_id, fingerprint, service, alertname, severity, root_cause, fix_action, ttr_seconds, incident_id, resolved_at)
        VALUES (${tenantId}::uuid, ${fp}, ${inc.service}, ${inc.title}, ${inc.severity}, ${inc.suggested_root_cause}, ${fixAction}::jsonb, ${ttr}, ${incidentId}::uuid, ${resolvedAt})
      `,
    ).catch(() => {})
  }
}
