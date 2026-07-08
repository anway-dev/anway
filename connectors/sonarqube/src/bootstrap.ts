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

    // Confirmed live via independent review: `!res.ok` and the outer catch
    // both swallowed every failure (invalid token, network outage,
    // malformed JSON) as a plausible "connection failed" success with 0
    // entities. baseUrl defaults to localhost:9000, a real unauthenticated
    // local dev setup, so a connection-level failure (fetch() itself
    // throwing) stays legitimately empty (same reasoning as elastic/
    // grafana/loki's bootstraps this session), but an HTTP-level error
    // response (401/403/5xx — the server actually answered) now throws.
    let res: Response
    try {
      res = await fetch(`${baseUrl}/api/projects/search`, { headers })
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['SonarQube bootstrap: instance unreachable'] }
    }
    if (!res.ok) {
      throw new Error(`SonarQube bootstrap: /api/projects/search failed with HTTP ${res.status}`)
    }
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
  }
}
