import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class GcpMonitoringBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    let entities = 0
    const projects = (_payload.projects as string[]) ?? ['default']
    for (const project of projects) {
      const entityId = await this.kg.upsertEntity(
        { type: 'Alert', name: `gcp-monitoring-${project}`, metadata: { source: 'gcp-monitoring', project, connectorId } },
        tenantId,
      )
      if (entityId) entities++
    }
    return {
      entitiesUpserted: entities,
      relationshipsUpserted: 0,
      episodeHints: [`GCP Monitoring connector bootstrapped — ${projects.length} project(s)`],
    }
  }
}
