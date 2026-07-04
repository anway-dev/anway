import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface NewRelicConn {
  apiKey: string
  accountId: string
  baseUrl: string
}

function resolveCreds(creds: Record<string, unknown>): NewRelicConn | null {
  const apiKey = creds['apiKey'] ?? process.env['NEW_RELIC_API_KEY']
  const accountId = creds['accountId'] ?? process.env['NEW_RELIC_ACCOUNT_ID']
  const baseUrl = creds['baseUrl']
  if (typeof apiKey !== 'string' || !apiKey) return null
  if (!accountId || (typeof accountId !== 'string' && typeof accountId !== 'number')) return null
  return {
    apiKey,
    accountId: String(accountId),
    baseUrl: typeof baseUrl === 'string' ? (baseUrl as string).replace(/\/$/, '') : 'https://api.newrelic.com',
  }
}

/** Map shorthand window like "1h" to NRQL SINCE clause like "1 hour". */
function mapWindow(window: string): string {
  const match = window.match(/^(\d+)([smhd])$/)
  if (!match) return '1 hour'
  const num = parseInt(match[1]!, 10)
  const unit = match[2]!
  const units: Record<string, string> = { s: 'second', m: 'minute', h: 'hour', d: 'day' }
  const unitName = units[unit] ?? 'hour'
  return `${num} ${unitName}${num !== 1 ? 's' : ''}`
}

/** Escape single quotes inside an NRQL string literal. */
function escapeNrql(s: string): string {
  return s.replace(/'/g, "\\'")
}

async function nerdGraphQuery(
  conn: NewRelicConn,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown | null> {
  try {
    const res = await fetch(`${conn.baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Api-Key': conn.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> }
    if (json.errors?.length) return null
    return json.data ?? null
  } catch {
    return null
  }
}

const NERDGRAPH_QUERY = `
query($accountId: Int!, $nrql: Nrql!) {
  actor {
    account(id: $accountId) {
      nrql(query: $nrql) {
        results
      }
    }
  }
}
`

interface TimeseriesBucket {
  beginTimeSeconds: number
  endTimeSeconds: number
  [key: string]: unknown
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_metrics',
      description: 'Fetch metrics for a service via NRQL TIMESERIES query through NerdGraph. Requires accountId in creds (real NerdGraph requirement).',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          window: { type: 'string' },
          metric: { type: 'string', optional: true },
        },
        required: ['service', 'window'],
      },
    },
    execute: async (params, creds) => {
      const conn = resolveCreds(creds)
      if (!conn) return { points: [], unit: 'unknown' }

      const service = escapeNrql(String(params.service))
      const window = String(params.window)
      const metric = typeof params.metric === 'string' ? (params.metric as string) : 'duration'
      // Backtick-quote metric name if it contains dots (e.g. apm.service.transaction.duration)
      const metricRef = metric.includes('.') ? `\`${metric}\`` : metric
      const nrql = `SELECT average(${metricRef}) AS value FROM Metric WHERE appName = '${service}' SINCE ${mapWindow(window)} ago TIMESERIES`

      const data = await nerdGraphQuery(conn, NERDGRAPH_QUERY, {
        accountId: parseInt(conn.accountId, 10),
        nrql,
      })
      if (!data) return { points: [], unit: metric }

      const nrqlResult = (data as { actor?: { account?: { nrql?: { results?: TimeseriesBucket[] } } } })
        .actor?.account?.nrql
      if (!nrqlResult?.results?.length) return { points: [], unit: metric }

      return {
        points: nrqlResult.results.map((bucket: TimeseriesBucket) => ({
          t: bucket.beginTimeSeconds * 1000, // convert seconds → ms for backward compat
          v: (bucket['value'] ?? bucket['average'] ?? 0) as number,
        })),
        unit: metric,
      }
    },
    write: false,
  },
  {
    definition: {
      name: 'get_alerts',
      description:
        'List active New Relic issues/alerts via NerdGraph NRQL against NrAiIssue. Requires accountId in creds (real NerdGraph requirement).',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', optional: true },
          severity: { type: 'string', optional: true },
        },
      },
    },
    execute: async (params, creds) => {
      const conn = resolveCreds(creds)
      if (!conn) return { alerts: [] }

      // Build NRQL with optional filters against NrAiIssue (modern New Relic issue tracking)
      const conditions: string[] = ["state IN ('ACTIVATED', 'CREATED')"]
      if (typeof params.service === 'string' && params.service) {
        conditions.push(`entity.name = '${escapeNrql(String(params.service))}'`)
      }
      if (typeof params.severity === 'string' && params.severity) {
        conditions.push(`priority = '${escapeNrql(String(params.severity).toUpperCase())}'`)
      }
      const nrql = `SELECT * FROM NrAiIssue WHERE ${conditions.join(' AND ')} SINCE 24 hours ago LIMIT 50`

      const data = await nerdGraphQuery(conn, NERDGRAPH_QUERY, {
        accountId: parseInt(conn.accountId, 10),
        nrql,
      })
      if (!data) return { alerts: [] }

      const results = (data as { actor?: { account?: { nrql?: { results?: Array<Record<string, unknown>> } } } })
        .actor?.account?.nrql?.results
      if (!results?.length) return { alerts: [] }

      return {
        alerts: results.map((row: Record<string, unknown>) => {
          const priority = String(row['priority'] ?? '').toUpperCase()
          const state = String(row['state'] ?? '').toUpperCase()
          const firedTimestamp =
            (row['activatedAt'] as number) ?? (row['createdAt'] as number) ?? Date.now()
          return {
            id: String(row['issueId'] ?? ''),
            title: String(row['title'] ?? ''),
            severity: priority === 'CRITICAL' ? 'critical'
              : priority === 'HIGH' ? 'high'
              : priority === 'MEDIUM' ? 'medium'
              : priority === 'LOW' ? 'low'
              : priority.toLowerCase() || 'unknown',
            status: state === 'CLOSED' ? 'resolved' : 'firing',
            firedAt: new Date(firedTimestamp).toISOString(),
          }
        }),
      }
    },
    write: false,
  },
  {
    definition: {
      name: 'get_logs',
      description: 'Search logs for a service via NRQL against the Log event type through NerdGraph. Requires accountId in creds.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          query: { type: 'string' },
          limit: { type: 'number', optional: true },
        },
        required: ['service', 'query'],
      },
    },
    execute: async (params, creds) => {
      const conn = resolveCreds(creds)
      if (!conn) return { lines: [] }

      const service = escapeNrql(String(params.service))
      const query = escapeNrql(String(params.query))
      const limit = typeof params.limit === 'number' ? (params.limit as number) : 20
      const nrql = `SELECT timestamp, level, message FROM Log WHERE appName = '${service}' AND message LIKE '%${query}%' SINCE 1 hour ago LIMIT ${limit}`

      const data = await nerdGraphQuery(conn, NERDGRAPH_QUERY, {
        accountId: parseInt(conn.accountId, 10),
        nrql,
      })
      if (!data) return { lines: [] }

      const results = (data as { actor?: { account?: { nrql?: { results?: Array<Record<string, unknown>> } } } })
        .actor?.account?.nrql?.results
      if (!results?.length) return { lines: [] }

      return {
        lines: results.map((row: Record<string, unknown>) => ({
          ts: new Date((row['timestamp'] as number) ?? Date.now()).toISOString(),
          level: String(row['level'] ?? 'INFO'),
          msg: String(row['message'] ?? ''),
        })),
      }
    },
    write: false,
  },
]

export class NewrelicAgent implements IConnectorAgent {
  readonly connectorType = 'newrelic'
  readonly tools = TOOLS
}
