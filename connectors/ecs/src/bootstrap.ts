import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class EcsBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    let entities = 0
    const cluster = (payload.cluster as string) ?? 'default'
    const services = (payload.services as string[]) ?? []

    // Seed Service entities with connectorCoordinates.ecs = {cluster, service}
    for (const svc of services) {
      const entityId = await this.kg.upsertEntity(
        {
          type: 'Service',
          name: svc,
          metadata: {
            source: 'ecs',
            cluster,
            connectorId,
            // Confirmed live via product verification (while wiring the
            // editor's real deploy flow): this previously put `cluster`/
            // `service` directly under `ecs`, not matching the documented
            // ConnectorCoordinates shape (`resourceIds: Record<string,
            // string>`) that k8s's bootstrap already follows — a caller
            // reading `connectorCoordinates.ecs.resourceIds.cluster` (the
            // shape every other connector uses) would get undefined.
            connectorCoordinates: { ecs: { resourceIds: { cluster, service: svc } } },
          },
        },
        tenantId,
      )
      if (entityId) entities++
    }

    if (services.length === 0) {
      // At minimum, mark the connector as active
      const entityId = await this.kg.upsertEntity(
        { type: 'Service', name: `ecs-${cluster}`, metadata: { source: 'ecs', cluster, connectorId } },
        tenantId,
      )
      if (entityId) entities++
    }

    return {
      entitiesUpserted: entities,
      relationshipsUpserted: 0,
      episodeHints: [`ECS connector bootstrapped — cluster: ${cluster}, ${services.length} service(s)`],
    }
  }
}
