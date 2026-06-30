import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class DynatraceBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(_tenantId: TenantId, _connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Dynatrace bootstrap: connector credentials not yet configured'] }
  }
}
