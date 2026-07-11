import { PrismaClient, IncidentSeverity, IncidentStatus } from '@prisma/client'
import { withTenant } from '../db/prisma.js'

/** Strip HTML tags and trim — prevents XSS in stored text fields. */
function sanitizeText(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

export class IncidentService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, data: { title: string; severity: IncidentSeverity; description?: string; envId?: string | null }) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.create({
        data: {
          tenant_id: tenantId,
          title: sanitizeText(data.title),
          severity: data.severity,
          status: 'active' as IncidentStatus,
          description: data.description ? sanitizeText(data.description) : null,
          // env scoping: stamp the creator's active environment; system-created
          // incidents (webhooks/triggers) pass nothing and stay global (NULL)
          env_id: data.envId ?? null,
        },
      })
    )
  }

  async get(id: string, tenantId: string) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.findFirst({ where: { id, tenant_id: tenantId } })
    )
  }

  async update(id: string, tenantId: string, data: Partial<{ title: string; status: IncidentStatus; description: string }>) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.updateMany({ where: { id, tenant_id: tenantId }, data })
    )
  }

  async setRootCause(id: string, tenantId: string, suggestedRootCause: string) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.updateMany({ where: { id, tenant_id: tenantId }, data: { suggested_root_cause: suggestedRootCause } })
    )
  }

  async list(tenantId: string, filters?: { status?: IncidentStatus; severity?: IncidentSeverity; cursor?: string; limit?: number; envId?: string | null }) {
    const { status, severity, cursor, limit = 50, envId } = filters ?? {}
    // Cursor is ISO timestamp for chronological ordering
    const cursorDate = cursor ? new Date(cursor) : undefined
    return withTenant(this.prisma, tenantId, async (tx) => {
      const rows = await tx.incident.findMany({
        where: {
          tenant_id: tenantId,
          // env scoping: global rows (env_id NULL) show everywhere; pinned
          // rows only in their own environment. envId undefined = no scoping
          // (system callers); null = unknown env name → global rows only.
          ...(envId !== undefined ? { OR: [{ env_id: null }, ...(envId ? [{ env_id: envId }] : [])] } : {}),
          ...(status ? { status } : {}),
          ...(severity ? { severity } : {}),
          ...(cursorDate ? { created_at: { lt: cursorDate } } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit + 1,
      })
      const hasMore = rows.length > limit
      const data = hasMore ? rows.slice(0, limit) : rows
      return { data, nextCursor: hasMore ? data[data.length - 1]!.created_at.toISOString() : null }
    })
  }

  async resolve(id: string, tenantId: string) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.updateMany({ where: { id, tenant_id: tenantId }, data: { status: 'resolved' as IncidentStatus, resolved_at: new Date() } })
    )
  }
}
