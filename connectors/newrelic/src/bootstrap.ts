import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class NewRelicBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly apiKey?: string,
    private readonly baseUrl?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'https://api.newrelic.com'
    const apiKey = (payload['apiKey'] as string | undefined) ?? process.env['NEW_RELIC_API_KEY']
    const apiKey = (payload['apiKey'] as string | undefined) ?? this.apiKey
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? this.baseUrl ?? baseUrl
    if (!apiKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['newrelic: no credentials configured'] }
    }

    const headers: Record<string, string> = {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
    }

    let entitiesUpserted = 0

    // Fetch APM applications
    const resp = await fetch(`${baseUrl}/v2/applications.json`, { headers })
    if (resp.ok) {
      const data = await resp.json() as { applications?: Array<{ id: number; name: string; health_status?: string; summary?: { apdex_score?: number } }> }
      for (const app of (data.applications ?? [])) {
        await this.kg.upsertEntity({
          type: 'Service', name: app.name,
          metadata: {
            health: app.health_status ?? 'unknown',
            apdex: app.summary?.apdex_score ?? 0,
            externalId: String(app.id),
            connectorCoordinates: { newrelic: { resourceIds: { appId: String(app.id), appName: app.name } } },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: entitiesUpserted > 0 ? [`newrelic: bootstrapped ${entitiesUpserted} services`] : ['newrelic: no entities found'],
    }
  }
}
