import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class GrafanaBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(_tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] ?? payload['url'] ?? process.env['GRAFANA_URL'] ?? 'http://localhost:3000') as string
    const token = (payload['token'] ?? payload['apiKey'] ?? process.env['GRAFANA_API_KEY']) as string | undefined
    if (!token) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Grafana bootstrap: no API key configured'] }

    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    try {
      // Fetch dashboards
      const dashResp = await fetch(`${baseUrl}/api/search?type=dash-db&limit=100`, { headers })
      const dashboards = dashResp.ok ? await dashResp.json() as Array<{ uid: string; title: string }> : []

      // Fetch alert rules
      const alertResp = await fetch(`${baseUrl}/api/v1/provisioning/alert-rules`, { headers })
      const alertRules = alertResp.ok ? await alertResp.json() as Array<{ uid: string; title: string; labels?: Record<string, string> }> : []

      // Fetch datasources (services monitoring)
      const dsResp = await fetch(`${baseUrl}/api/datasources`, { headers })
      const datasources = dsResp.ok ? await dsResp.json() as Array<{ uid: string; name: string; type: string }> : []

      // Upsert discovered services from datasources
      for (const ds of datasources) {
        await this.kg.upsertEntity({
          id: `grafana-ds-${ds.uid}`, type: 'Service', name: ds.name, tenantId: _tenantId,
          metadata: { source: 'grafana', type: ds.type, externalId: ds.uid },
        })
      }

      // Record dashboards as knowledge entries
      for (const dash of dashboards) {
        await this.kg.addEpisode({
          type: 'grafana_dashboard', tenantId: _tenantId, title: dash.title,
          payload: { uid: dash.uid }, at: new Date(),
        })
      }

      // Record alert rules
      for (const rule of alertRules) {
        await this.kg.addEpisode({
          type: 'grafana_alert_rule', tenantId: _tenantId, title: rule.title,
          payload: { uid: rule.uid, labels: rule.labels }, at: new Date(),
        })
      }

      return {
        entitiesUpserted: datasources.length,
        relationshipsUpserted: 0,
        episodeHints: [`Grafana: ${dashboards.length} dashboards, ${alertRules.length} alert rules, ${datasources.length} datasources`],
      }
    } catch (err) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`Grafana bootstrap failed: ${String(err)}`] }
    }
  }
}
