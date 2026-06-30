import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class LaunchDarklyBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const sdkKey = (payload['sdkKey'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? (payload['token'] as string | undefined) ?? ''
    const headers: Record<string, string> = { Authorization: `${sdkKey}`, 'Content-Type': 'application/json' }

    try {
      const res = await fetch(`${payload['baseUrl'] ?? 'https://app.launchdarkly.com'}/api/v2/projects`, { headers })
      if (!res.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['LaunchDarkly bootstrap: API call failed'] }
      const data = await res.json() as { items?: Array<{ key: string; name: string }> }
      const projects = data.items ?? []
      let entitiesUpserted = 0
      for (const p of projects) {
        await this.kg.upsertEntity({
          type: 'Service', name: p.name,
          metadata: {
            source: 'launchdarkly',
            connectorCoordinates: { launchdarkly: { connectorType: 'launchdarkly', resourceIds: { projectKey: p.key }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`LaunchDarkly: ${entitiesUpserted} projects indexed`] }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['LaunchDarkly bootstrap: connection failed'] }
    }
  }
}
