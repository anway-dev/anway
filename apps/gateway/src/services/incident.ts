import { PrismaClient, IncidentSeverity, IncidentStatus } from '@prisma/client'

export class IncidentService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, data: { title: string; severity: IncidentSeverity; description?: string }) {
    return this.prisma.incident.create({
      data: {
        tenant_id: tenantId,
        title: data.title,
        severity: data.severity,
        status: 'active' as IncidentStatus,
      },
    })
  }

  async get(id: string, tenantId: string) {
    return this.prisma.incident.findFirst({
      where: { id, tenant_id: tenantId },
    })
  }

  async update(id: string, tenantId: string, data: Partial<{ title: string; status: IncidentStatus }>) {
    return this.prisma.incident.updateMany({
      where: { id, tenant_id: tenantId },
      data,
    })
  }

  async list(tenantId: string, filters?: { status?: IncidentStatus; severity?: IncidentSeverity }) {
    return this.prisma.incident.findMany({
      where: { tenant_id: tenantId, ...filters },
      orderBy: { created_at: 'desc' },
      take: 50,
    })
  }

  async resolve(id: string, tenantId: string) {
    return this.prisma.incident.updateMany({
      where: { id, tenant_id: tenantId },
      data: { status: 'resolved' as IncidentStatus, resolved_at: new Date() },
    })
  }
}
