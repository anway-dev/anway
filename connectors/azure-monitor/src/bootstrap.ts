import type { TenantId, IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'

export class AzureMonitorBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    let entities = 0
    let relationships = 0

    // Seed Alert entities for Azure Monitor alert rules and resource groups
    const resourceGroups = (_payload.resourceGroups as string[]) ?? ['default']
    for (const rg of resourceGroups) {
      const entityId = await this.kg.upsertEntity({
        tenantId,
        type: 'Alert',
        name: `azure-monitor-${rg}`,
        metadata: { source: 'azure-monitor', resourceGroup: rg, connectorId },
      })
      if (entityId) entities++
    }

    return {
      entitiesUpserted: entities,
      relationshipsUpserted: relationships,
      episodeHints: [`Azure Monitor connector bootstrapped — ${resourceGroups.length} resource group(s)`],
    }
  }
}
