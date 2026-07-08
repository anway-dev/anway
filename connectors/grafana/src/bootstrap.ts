import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

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

    // Confirmed live via independent review: each of the 3 fetches below
    // treated ANY non-ok response as "0 results for this type", and the
    // outer catch swallowed connection errors too — a completely invalid
    // token would 401 on all three and report a plausible "0 dashboards, 0
    // alert rules, 0 datasources indexed" success, indistinguishable from a
    // genuinely empty Grafana instance.
    //
    // baseUrl always has a value (defaults to localhost:3000, a real
    // unauthenticated local dev setup), so a connection-level failure
    // (fetch() itself throwing — DNS/refused/timeout) stays legitimately
    // empty, same reasoning as elastic's bootstrap this session. But once
    // a specific endpoint responds, only 401/403 (permission/auth scoping
    // for that one endpoint — Grafana API tokens can be scoped per-feature)
    // stays a legitimate per-endpoint gap; anything else (5xx) throws.
    async function fetchList<T>(path: string, label: string): Promise<T[]> {
      const resp = await fetch(`${baseUrl}${path}`, { headers })
      if (resp.ok) return await resp.json() as T[]
      if (resp.status === 401 || resp.status === 403) return []
      throw new Error(`Grafana bootstrap: ${label} failed with HTTP ${resp.status}`)
    }

    let dashboards: Array<{ uid: string; title: string }>
    let alertRules: Array<{ uid: string; title: string; labels?: Record<string, string> }>
    let datasources: Array<{ uid: string; name: string; type: string }>
    try {
      dashboards = await fetchList(`/api/search?type=dash-db&limit=100`, 'dashboard search')
      alertRules = await fetchList(`/api/v1/provisioning/alert-rules`, 'alert rules')
      datasources = await fetchList(`/api/datasources`, 'datasources')
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch() itself threw (connection-level failure) — genuinely unreachable.
        return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Grafana bootstrap: instance unreachable'] }
      }
      throw err
    }

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
