import type { TenantId, IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'

export class GcpMonitoringBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    let entities = 0

    // Seed Alert entities for GCP alerting policies and monitored services
    const projects = (_payload.projects as string[]) ?? ['default']
    for (const project of projects) {
      const entityId = await this.kg.upsertEntity({
        tenantId,
        type: 'Alert',
        name: `gcp-monitoring-${project}`,
        metadata: { source: 'gcp-monitoring', project, connectorId },
      })
      if (entityId) entities++
    }

    return {
      entitiesUpserted: entities,
      relationshipsUpserted: 0,
      episodeHints: [`GCP Monitoring connector bootstrapped — ${projects.length} project(s)`],
    }
  }
}
