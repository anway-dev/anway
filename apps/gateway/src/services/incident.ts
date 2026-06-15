import { PrismaClient, IncidentSeverity, IncidentStatus } from '@prisma/client'
import { withTenant } from '../db/prisma.js'

/** Strip HTML tags and trim — prevents XSS in stored text fields. */
function sanitizeText(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

export class IncidentService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, data: { title: string; severity: IncidentSeverity; description?: string }) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.create({
        data: {
          tenant_id: tenantId,
          title: sanitizeText(data.title),
          severity: data.severity,
          status: 'active' as IncidentStatus,
          description: data.description ? sanitizeText(data.description) : null,
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

  async list(tenantId: string, filters?: { status?: IncidentStatus; severity?: IncidentSeverity; cursor?: string; limit?: number }) {
    const { status, severity, cursor, limit = 50 } = filters ?? {}
    return withTenant(this.prisma, tenantId, async (tx) => {
      const rows = await tx.incident.findMany({
        where: { tenant_id: tenantId, ...(status ? { status } : {}), ...(severity ? { severity } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: limit + 1,
      })
      const hasMore = rows.length > limit
      const data = hasMore ? rows.slice(0, limit) : rows
      return { data, nextCursor: hasMore ? data[data.length - 1]!.id : null }
    })
  }

  async resolve(id: string, tenantId: string) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.updateMany({ where: { id, tenant_id: tenantId }, data: { status: 'resolved' as IncidentStatus, resolved_at: new Date() } })
    )
  }
}
