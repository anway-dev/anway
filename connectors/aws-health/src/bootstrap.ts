import type { TenantId, IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'

export class AwsHealthBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    let entities = 0
    let relationships = 0
    const hints: string[] = []

    // Seed region-scoped Alert entities for AWS Health events
    const regions = (_payload.regions as string[]) ?? ['us-east-1', 'us-west-2', 'eu-west-1']
    for (const region of regions) {
      const entityId = await this.kg.upsertEntity({
        tenantId,
        type: 'Alert',
        name: `aws-health-${region}`,
        metadata: { source: 'aws-health', region, connectorId },
      })
      if (entityId) entities++
      hints.push(`AWS Health connector bootstrapped for region ${region}`)
    }

    return { entitiesUpserted: entities, relationshipsUpserted: relationships, episodeHints: hints }
  }
}
