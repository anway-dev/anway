import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface NotionConn { baseUrl: string; token: string }

function connFromCreds(creds: Record<string, unknown>): NotionConn {
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined)
  if (typeof token !== 'string' || !token) throw new Error('Notion credentials not configured (token/apiKey)')
  const baseUrl = typeof creds['baseUrl'] === 'string' ? (creds['baseUrl'] as string).replace(/\/$/, '') : 'https://api.notion.com'
  return { baseUrl, token }
}

/**
 * Extract a page title from Notion's real page object shape.
 *
 * Notion pages store their title in `properties` as a property whose `type` is `"title"`.
 * That property has a `title` field which is an array of rich-text objects,
 * each with a `plain_text` field.
 *
 * Example shape (real Notion API):
 *   properties: {
 *     "Name": { type: "title", title: [{ plain_text: "Runbook" }, ...] }
 *     // or for pages not in a database, the key is literally "title"
 *   }
 *
 * Strategy:
 *   1. Find the first property with `type === "title"`.
 *   2. Join all `plain_text` segments from its `title` array.
 *   3. Fall back to the page id if no title property is found.
 */
function extractPageTitle(page: Record<string, unknown>): string {
  try {
    const props = page['properties'] as Record<string, Record<string, unknown>> | undefined
    if (!props) return page['id'] as string ?? 'untitled'

    for (const prop of Object.values(props)) {
      if (prop['type'] === 'title') {
        const titleArr = prop['title'] as Array<{ plain_text?: string }> | undefined
        if (titleArr && titleArr.length > 0) {
          return titleArr.map(t => t.plain_text ?? '').join('').trim() || (page['id'] as string ?? 'untitled')
        }
      }
    }
    return page['id'] as string ?? 'untitled'
  } catch {
    return (page['id'] as string) ?? 'untitled'
  }
}

interface NotionSearchResult {
  id: string
  url?: string
  last_edited_time?: string
  properties?: Record<string, unknown>
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'search_pages',
      description: 'Search Notion pages by title/content. Queries the Notion search API scoped to pages only.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)

      const query = typeof params.query === 'string' ? (params.query as string).trim() : ''
      if (!query) throw new Error('Notion search_pages: query is required')

      const res = await fetch(`${conn.baseUrl}/v1/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${conn.token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          filter: { value: 'page', property: 'object' },
        }),
      })

      if (!res.ok) throw new Error(`Notion search_pages failed: HTTP ${res.status}`)

      const data = (await res.json()) as { results?: Array<NotionSearchResult & { object?: string }> }
      const results = (data.results ?? []).filter(r => r.object === 'page')

      return {
        pages: results.map(r => ({
          id: r.id,
          title: extractPageTitle(r as unknown as Record<string, unknown>),
          url: r.url ?? `https://www.notion.so/${r.id.replace(/-/g, '')}`,
          updatedAt: r.last_edited_time ?? new Date().toISOString(),
        })),
      }
    },
    write: false,
  },
]

export class NotionAgent implements IConnectorAgent {
  readonly connectorType = 'notion'
  readonly tools = TOOLS
}
