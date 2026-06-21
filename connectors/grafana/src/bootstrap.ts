import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class GrafanaBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly baseUrl?: string,
    private readonly apiToken?: string,
  ) {}

  async bootstrap(_tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] ?? payload['url'] ?? this.baseUrl ?? process.env['GRAFANA_URL'] ?? 'http://localhost:3000') as string
    // publicUrl is the browser-accessible URL for dashboard links — may differ from internal API baseUrl
    const publicUrl = (payload['dashboardUrl'] ?? payload['publicUrl'] ?? payload['externalUrl'] ?? baseUrl) as string
    const token = (payload['token'] ?? payload['apiKey'] ?? this.apiToken ?? process.env['GRAFANA_API_KEY']) as string | undefined
    const user = (payload['user'] ?? payload['username'] ?? 'admin') as string
    const password = (payload['password'] ?? '') as string
    const authHeader = token
      ? `Bearer ${token}`
      : `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
    const headers: Record<string, string> = { Authorization: authHeader, 'Content-Type': 'application/json' }

    let entitiesUpserted = 0

    // Fetch dashboards
    const dashResp = await fetch(`${baseUrl}/api/search?type=dash-db&limit=100`, { headers })
    const dashboards = dashResp.ok ? await dashResp.json() as Array<{ uid: string; title: string }> : []

    // Fetch alert rules
    const alertResp = await fetch(`${baseUrl}/api/v1/provisioning/alert-rules`, { headers })
    const alertRules = alertResp.ok ? await alertResp.json() as Array<{ uid: string; title: string; labels?: Record<string, string> }> : []

    // Fetch datasources — each datasource becomes a Service entity so agents can
    // resolve "which Grafana datasource backs this service"
    const dsResp = await fetch(`${baseUrl}/api/datasources`, { headers })
    const datasources = dsResp.ok ? await dsResp.json() as Array<{ uid: string; name: string; type: string }> : []

    for (const ds of datasources) {
      await this.kg.upsertEntity({
        type: 'Service', name: ds.name,
        metadata: {
          source: 'grafana', type: ds.type, externalId: ds.uid,
          connectorCoordinates: { grafana: { connectorType: 'grafana', resourceIds: { uid: ds.uid, name: ds.name }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, _tenantId)
      entitiesUpserted++
    }

    for (const dash of dashboards) {
      await this.kg.upsertEntity({
        type: 'Dashboard', name: dash.title,
        metadata: {
          externalId: dash.uid,
          url: `${publicUrl}/d/${dash.uid}`,
          connectorCoordinates: { grafana: { connectorType: 'grafana', resourceIds: { uid: dash.uid, title: dash.title }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, _tenantId)
      entitiesUpserted++
    }

    for (const rule of alertRules) {
      await this.kg.upsertEntity({
        type: 'Alert', name: rule.title,
        metadata: {
          externalId: rule.uid,
          labels: rule.labels ?? {},
          connectorCoordinates: { grafana: { connectorType: 'grafana', resourceIds: { uid: rule.uid, title: rule.title }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, _tenantId)
      entitiesUpserted++
    }

    // Relationships (Dashboard→MONITORS→Service, Alert→MONITORS→Service) are resolved
    // by the mapping phase that runs after every bootstrap — not inline here.
    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: [`Grafana: ${dashboards.length} dashboards, ${alertRules.length} alert rules, ${datasources.length} datasources indexed`],
    }
  }
}
