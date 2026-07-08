import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class ElasticsearchBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'http://localhost:9200'
    const user = (payload['user'] as string | undefined) ?? ''
    const password = (payload['password'] as string | undefined) ?? ''
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined)
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    } else if (user && password) {
      headers['Authorization'] = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
    }

    // Confirmed live via independent review: `!res.ok` and the outer catch
    // both swallowed every failure (invalid credentials, network outage,
    // malformed JSON) as a plausible "connection failed" success with 0
    // entities — identical to a genuinely empty cluster.
    //
    // baseUrl always has a value (defaults to localhost:9200, a real,
    // common unauthenticated local dev setup), so a CONNECTION-level
    // failure (fetch() itself throwing — DNS/refused/timeout) stays a
    // legitimate empty result: nothing is actually reachable at all,
    // which for a bare default host is "not really configured yet", the
    // same class as ArgoCD's ENOENT case. But once the server actually
    // responds, an HTTP-level error (401/403/5xx) is a real, reachable
    // failure that must not look identical to "empty cluster".
    let res: Response
    try {
      res = await fetch(`${baseUrl}/_cat/indices?format=json&h=index,docs.count,store.size`, { headers })
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Elasticsearch bootstrap: cluster unreachable'] }
    }
    if (!res.ok) {
      throw new Error(`Elasticsearch bootstrap: _cat/indices failed with HTTP ${res.status}`)
    }
    const indices = await res.json() as Array<{ index: string; 'docs.count': string }>
    let entitiesUpserted = 0
    for (const idx of indices) {
      if (idx.index.startsWith('.')) continue // skip system indices
      await this.kg.upsertEntity({
        type: 'Index', name: idx.index,
        metadata: {
          source: 'elastic', docCount: idx['docs.count'],
          connectorCoordinates: { elastic: { connectorType: 'elastic', resourceIds: { index: idx.index }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, tenantId)
      entitiesUpserted++
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Elasticsearch: ${entitiesUpserted} indices indexed`] }
  }
}
