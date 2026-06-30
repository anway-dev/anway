import type { TenantId } from '@anway/types'

export interface ConnectorBootstrapResult {
  entitiesUpserted: number
  relationshipsUpserted: number
  episodeHints: string[]
  metadata?: Record<string, unknown>
}

export interface IConnectorBootstrap {
  /**
   * Bootstraps entities and relationships from a connector into the Knowledge Graph.
   * Called once on `connector_registered` events.
   */
  bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult>
}
