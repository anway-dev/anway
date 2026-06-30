import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class CoralogixBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const apiKey = (payload['apiKey'] as string | undefined) ?? (payload['token'] as string | undefined) ?? ''
    const region = (payload['region'] as string | undefined) ?? 'us1'
    const domain = (payload['baseUrl'] as string) ?? `ng-api-http.${region}.coralogix.com`
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

    try {
      const res = await fetch(`https://${domain}/api/v1/logs/get-applications`, {
        method: 'POST', headers,
        body: JSON.stringify({}),
      })
      if (!res.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Coralogix bootstrap: API call failed'] }
      const data = await res.json() as { applications?: Array<{ name: string }> }
      const apps = data.applications ?? []
      let entitiesUpserted = 0
      for (const app of apps) {
        await this.kg.upsertEntity({
          type: 'Service', name: app.name,
          metadata: {
            source: 'coralogix', region,
            connectorCoordinates: { coralogix: { connectorType: 'coralogix', resourceIds: { application: app.name, region }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Coralogix: ${entitiesUpserted} applications indexed`] }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Coralogix bootstrap: connection failed'] }
    }
  }
}
