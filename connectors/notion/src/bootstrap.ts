import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class NotionBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    if (!token) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Notion bootstrap: no API token configured'] }
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    }

    // Confirmed live via independent review: `!res.ok` and the outer catch
    // both swallowed every failure (invalid token, network outage,
    // malformed JSON) as a plausible "API/connection failed" success with
    // 0 entities. This hits Notion's real cloud API (not a local default),
    // so a network failure is a real outage worth surfacing, not
    // swallowing — only "no token configured" (above) is legitimately empty.
    const res = await fetch(`${payload['baseUrl'] ?? 'https://api.notion.com'}/v1/search`, {
      method: 'POST', headers,
      body: JSON.stringify({ filter: { value: 'database', property: 'object' } }),
    })
    if (!res.ok) {
      throw new Error(`Notion bootstrap: /v1/search failed with HTTP ${res.status}`)
    }
    const data = await res.json() as { results?: Array<{ id: string; title?: Array<{ plain_text: string }> }> }
    const results = data.results ?? []
    let entitiesUpserted = 0
    for (const db of results) {
      const title = db.title?.[0]?.plain_text ?? db.id
      await this.kg.upsertEntity({
        type: 'Service', name: title,
        metadata: {
          source: 'notion', databaseId: db.id,
          connectorCoordinates: { notion: { connectorType: 'notion', resourceIds: { databaseId: db.id }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, tenantId)
      entitiesUpserted++
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Notion: ${entitiesUpserted} databases indexed`] }
  }
}
