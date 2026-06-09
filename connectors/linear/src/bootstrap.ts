import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class LinearBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly apiKey?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    if (!this.apiKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Linear bootstrap: no API key'] }
    }
    return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Linear bootstrap: SDK not wired'] }
  }
}
