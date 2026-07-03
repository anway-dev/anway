import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class AzureMonitorBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    let entities = 0
    const resourceGroups = (_payload.resourceGroups as string[]) ?? ['default']
    for (const rg of resourceGroups) {
      const entityId = await this.kg.upsertEntity(
        { type: 'Alert', name: `azure-monitor-${rg}`, metadata: { source: 'azure-monitor', resourceGroup: rg, connectorId } },
        tenantId,
      )
      if (entityId) entities++
    }
    return {
      entitiesUpserted: entities,
      relationshipsUpserted: 0,
      episodeHints: [`Azure Monitor connector bootstrapped — ${resourceGroups.length} resource group(s)`],
    }
  }
}
