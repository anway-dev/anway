import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class SonarQubeBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'http://localhost:9000'
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    const auth = Buffer.from(`${token}:`).toString('base64')
    const headers: Record<string, string> = { Authorization: `Basic ${auth}` }

    try {
      const res = await fetch(`${baseUrl}/api/projects/search`, { headers })
      if (!res.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['SonarQube bootstrap: connection failed'] }
      const data = await res.json() as { components?: Array<{ key: string; name: string; qualifier: string }> }
      const components = data.components ?? []
      let entitiesUpserted = 0
      for (const c of components) {
        await this.kg.upsertEntity({
          type: 'Repo', name: c.name,
          metadata: {
            source: 'sonarqube', qualifier: c.qualifier,
            connectorCoordinates: { sonarqube: { connectorType: 'sonarqube', resourceIds: { projectKey: c.key }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`SonarQube: ${entitiesUpserted} projects indexed`] }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['SonarQube bootstrap: connection failed'] }
    }
  }
}
