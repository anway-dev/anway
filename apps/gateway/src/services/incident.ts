import { PrismaClient, IncidentSeverity, IncidentStatus } from '@prisma/client'
import { withTenant } from '../db/prisma.js'

export class IncidentService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, data: { title: string; severity: IncidentSeverity; description?: string }) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.create({
        data: {
          tenant_id: tenantId,
          title: data.title,
          severity: data.severity,
          status: 'active' as IncidentStatus,
          description: data.description ?? null,
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

  async list(tenantId: string, filters?: { status?: IncidentStatus; severity?: IncidentSeverity }) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.findMany({ where: { tenant_id: tenantId, ...filters }, orderBy: { created_at: 'desc' }, take: 50 })
    )
  }

  async resolve(id: string, tenantId: string) {
    return withTenant(this.prisma, tenantId, (tx) =>
      tx.incident.updateMany({ where: { id, tenant_id: tenantId }, data: { status: 'resolved' as IncidentStatus, resolved_at: new Date() } })
    )
  }
}
