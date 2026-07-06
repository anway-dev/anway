import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface ConfluenceConn { baseUrl: string; email: string; apiToken: string }

function connFromCreds(creds: Record<string, unknown>): ConfluenceConn {
  const baseUrl = creds['baseUrl']
  const email = creds['email']
  const apiToken = creds['apiToken']
  if (typeof baseUrl !== 'string' || typeof email !== 'string' || typeof apiToken !== 'string') {
    throw new Error('Confluence credentials not configured (baseUrl/email/apiToken)')
  }
  return { baseUrl: (baseUrl as string).replace(/\/$/, ''), email, apiToken }
}

interface ConfluenceSearchResult {
  id: string
  title: string
  type: string
  _links?: { webui?: string }
  version?: { when?: string }
  history?: { lastUpdated?: { when?: string } }
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'search_pages',
      description:
        'Search Confluence pages by title/content text using CQL. Returns matching pages with id, title, url, and last-updated timestamp.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', optional: true },
        },
        required: ['query'],
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)

      const query = String(params.query ?? '').trim()
      if (!query) throw new Error('Confluence search_pages: query is required')

      const limit = typeof params.limit === 'number' ? (params.limit as number) : 25

      const auth = Buffer.from(`${conn.email}:${conn.apiToken}`).toString('base64')
      const url = `${conn.baseUrl}/wiki/rest/api/content/search?cql=text~${encodeURIComponent(`"${query}"`)}&limit=${limit}`
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`Confluence search_pages failed: HTTP ${res.status}`)

      const json = (await res.json()) as { results?: ConfluenceSearchResult[] }
      const results = json.results ?? []
      return {
        pages: results.map(r => {
          const updatedAt =
            r.version?.when ??
            r.history?.lastUpdated?.when ??
            new Date().toISOString()
          const webuiPath = r._links?.webui ?? ''
          const url = webuiPath ? `${conn.baseUrl}${webuiPath}` : `${conn.baseUrl}/wiki/spaces/pages/${r.id}`
          return { id: r.id, title: r.title, url, updatedAt }
        }),
      }
    },
    write: false,
  },
]

export class ConfluenceAgent implements IConnectorAgent {
  readonly connectorType = 'confluence'
  readonly tools = TOOLS
}
