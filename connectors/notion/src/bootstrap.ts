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
    // Cursor-paginate to completion with a hard budget (Notion:
    // start_cursor/has_more) — confirmed via independent review this
    // fetched one page (default 100), silently truncating larger workspaces.
    const MAX_DATABASES = 1000
    const results: Array<{ id: string; title?: Array<{ plain_text: string }> }> = []
    let truncated = false
    let startCursor: string | undefined
    for (;;) {
      const res = await fetch(`${payload['baseUrl'] ?? 'https://api.notion.com'}/v1/search`, {
        method: 'POST', headers,
        body: JSON.stringify({ filter: { value: 'database', property: 'object' }, ...(startCursor ? { start_cursor: startCursor } : {}) }),
      })
      if (!res.ok) {
        throw new Error(`Notion bootstrap: /v1/search failed with HTTP ${res.status}`)
      }
      const data = await res.json() as { results?: Array<{ id: string; title?: Array<{ plain_text: string }> }>; has_more?: boolean; next_cursor?: string | null }
      results.push(...(data.results ?? []))
      if (!data.has_more || !data.next_cursor) break
      if (results.length >= MAX_DATABASES) { truncated = true; break }
      startCursor = data.next_cursor
    }
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
    return {
      entitiesUpserted, relationshipsUpserted: 0,
      episodeHints: [
        `Notion: ${entitiesUpserted} databases indexed`,
        ...(truncated ? [`Notion bootstrap: TRUNCATED at ${MAX_DATABASES} databases — graph is partial`] : []),
      ],
    }
  }
}
