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

    try {
      const res = await fetch(`${baseUrl}/_cat/indices?format=json&h=index,docs.count,store.size`, { headers })
      if (!res.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Elasticsearch bootstrap: connection failed'] }
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
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Elasticsearch bootstrap: connection failed'] }
    }
  }
}
