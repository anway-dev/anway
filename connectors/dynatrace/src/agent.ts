import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface DynatraceConn {
  baseUrl: string
  token: string
}

function resolveCreds(creds: Record<string, unknown>): DynatraceConn | null {
  const host = (creds['host'] as string | undefined) ?? (creds['baseUrl'] as string | undefined)
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined)
  if (typeof host !== 'string' || !host) return null
  if (typeof token !== 'string' || !token) return null
  return { baseUrl: host.replace(/\/$/, ''), token }
}

/**
 * Map shorthand window like "1h" → Dynatrace relative-time format "now-1h".
 * Supported units: s, m, h, d, w. Invalid input defaults to "now-1h".
 */
function mapWindowToFrom(window: string): string {
  const match = window.match(/^(\d+)([smhdw])$/)
  if (!match) return 'now-1h'
  const num = parseInt(match[1]!, 10)
  const unit = match[2]!
  return `now-${num}${unit}`
}

/**
 * Convert a timestamp (seconds or milliseconds) to epoch milliseconds.
 * Dynatrace Metrics v2 returns milliseconds but some endpoints return seconds —
 * sniff the magnitude to normalize.
 */
function toEpochMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

/** Map generic severity term → Dynatrace severityLevel. Returns null if unknown. */
function mapSeverityToDynatrace(severity: string): string | null {
  const s = severity.toLowerCase()
  if (s === 'critical' || s === 'availability') return 'AVAILABILITY'
  if (s === 'error' || s === 'high') return 'ERROR'
  if (s === 'medium' || s === 'performance') return 'PERFORMANCE'
  if (s === 'low' || s === 'resource_contention') return 'RESOURCE_CONTENTION'
  if (s === 'info' || s === 'custom_alert') return 'CUSTOM_ALERT'
  if (s === 'monitoring_unavailable') return 'MONITORING_UNAVAILABLE'
  return null
}

/** Map Dynatrace severityLevel → generic severity term. */
function mapSeverityFromDynatrace(level: string): string {
  switch (level) {
    case 'AVAILABILITY': return 'critical'
    case 'ERROR': return 'high'
    case 'PERFORMANCE': return 'medium'
    case 'RESOURCE_CONTENTION': return 'low'
    case 'CUSTOM_ALERT': return 'info'
    case 'MONITORING_UNAVAILABLE': return 'warning'
    default: return level.toLowerCase()
  }
}

const HEADERS = { Accept: 'application/json' as const }

function authHeaders(token: string): Record<string, string> {
  return { ...HEADERS, Authorization: `Api-Token ${token}` }
}

// ── tool definitions ────────────────────────────────────────────────────

const TOOLS: ConnectorTool[] = [

  // ── get_metrics ─────────────────────────────────────────────────────

  {
    definition: {
      name: 'get_metrics',
      description:
        'Fetch metrics for a service via Dynatrace Metrics v2 API. ' +
        'Uses metricSelector + entitySelector=type(SERVICE),entityName.equals(service) to scope query to one service. ' +
        'If metric param is given it is used directly as the selector; otherwise defaults to builtin:service.requestCount.total.',
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
    // Confirmed live via independent review: missing creds, an empty
    // required param, a non-OK response, and a network error all
    // previously collapsed into the same empty-points "success" — masking
    // a real Dynatrace outage/auth failure as "no metrics". Throws now; a
    // genuine 200-OK-with-zero-datapoints result is unaffected (still
    // returns points: []).
    execute: async (params, creds) => {
      const conn = resolveCreds(creds)
      if (!conn) throw new Error('Dynatrace credentials not configured (host/token)')

      const service = String(params.service).trim()
      if (!service) throw new Error('Dynatrace get_metrics: service is required')

      const window = String(params.window)
      const metricSelector =
        typeof params.metric === 'string' && params.metric.trim()
          ? (params.metric as string).trim()
          : 'builtin:service.requestCount.total'
      const from = mapWindowToFrom(window)

      const url = new URL(`${conn.baseUrl}/api/v2/metrics/query`)
      url.searchParams.set('metricSelector', metricSelector)
      url.searchParams.set('entitySelector', `type(SERVICE),entityName.equals(${service})`)
      url.searchParams.set('from', from)

      const res = await fetch(url.toString(), { headers: authHeaders(conn.token) })
      if (!res.ok) throw new Error(`Dynatrace get_metrics failed: HTTP ${res.status}`)

      const json = (await res.json()) as {
        result?: Array<{
          metricId: string
          data?: Array<{ timestamps?: number[]; values?: number[] }>
        }>
      }
      const resultArray = json.result ?? []
      const points: Array<{ t: number; v: number }> = []
      for (const r of resultArray) {
        for (const d of r.data ?? []) {
          const timestamps = d.timestamps ?? []
          const values = d.values ?? []
          const len = Math.min(timestamps.length, values.length)
          for (let i = 0; i < len; i++) {
            points.push({ t: toEpochMs(timestamps[i]!), v: values[i]! })
          }
        }
      }
      return { points, unit: metricSelector }
    },
    write: false,
  },

  // ── get_alerts ──────────────────────────────────────────────────────

  {
    definition: {
      name: 'get_alerts',
      description:
        'List Dynatrace problems (alerts) via Problems v2 API. ' +
        'Server-side filters: status=OPEN, optional severityLevel. ' +
        'Optional service param filters results client-side by matching problem title and affected entity names.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', optional: true },
          severity: { type: 'string', optional: true },
        },
      },
    },
    // See get_metrics above — same fix, same reasoning.
    execute: async (params, creds) => {
      const conn = resolveCreds(creds)
      if (!conn) throw new Error('Dynatrace credentials not configured (host/token)')

      const service = typeof params.service === 'string' ? String(params.service).trim() : undefined
      const severityParam =
        typeof params.severity === 'string' ? String(params.severity).trim() : undefined

      // Build problemSelector: always filter OPEN, optionally add severityLevel
      const selectors: string[] = ['status("OPEN")']
      if (severityParam) {
        const dtSev = mapSeverityToDynatrace(severityParam)
        if (dtSev) selectors.push(`severityLevel("${dtSev}")`)
      }

      const url = new URL(`${conn.baseUrl}/api/v2/problems`)
      url.searchParams.set('problemSelector', selectors.join(','))
      url.searchParams.set('from', 'now-24h')

      const res = await fetch(url.toString(), { headers: authHeaders(conn.token) })
      if (!res.ok) throw new Error(`Dynatrace get_alerts failed: HTTP ${res.status}`)

      const json = (await res.json()) as {
        problems?: Array<{
          problemId: string
          title: string
          severityLevel: string
          status: string
          startTime: number
          affectedEntities?: Array<{ entityId?: { id?: string }; name?: string }>
        }>
      }
      let problems = json.problems ?? []

      // Client-side service filter when service param is supplied
      if (service) {
        const svc = service.toLowerCase()
        problems = problems.filter(p => {
          if (p.title.toLowerCase().includes(svc)) return true
          return (p.affectedEntities ?? []).some(
            e => (e.name ?? '').toLowerCase().includes(svc),
          )
        })
      }

      return {
        alerts: problems.map(p => ({
          id: p.problemId,
          title: p.title,
          severity: mapSeverityFromDynatrace(p.severityLevel),
          status: p.status === 'CLOSED' ? 'resolved' : 'firing',
          firedAt: new Date(toEpochMs(p.startTime)).toISOString(),
        })),
      }
    },
    write: false,
  },

  // ── get_logs ────────────────────────────────────────────────────────

  {
    definition: {
      name: 'get_logs',
      description:
        'Search logs for a service via Dynatrace Logs v2 API. ' +
        'Service scoping uses entitySelector=type(SERVICE),entityName.equals(service). ' +
        'Query string wrapped in DQL matchesPhrase(content, "QUERY") for phrase matching. ' +
        'Respects optional limit param (page size, default 20).',
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
    // See get_metrics above — same fix, same reasoning.
    execute: async (params, creds) => {
      const conn = resolveCreds(creds)
      if (!conn) throw new Error('Dynatrace credentials not configured (host/token)')

      const service = String(params.service).trim()
      if (!service) throw new Error('Dynatrace get_logs: service is required')

      const query = String(params.query).trim()
      if (!query) throw new Error('Dynatrace get_logs: query is required')

      const limit =
        typeof params.limit === 'number' && (params.limit as number) > 0
          ? Math.floor(params.limit as number)
          : 20

      // DQL: filter logs where content contains the query phrase.
      // Escaped double-quotes in user input to prevent DQL injection.
      const dql = `matchesPhrase(content, "${query.replace(/"/g, '\\"')}")`

      const url = new URL(`${conn.baseUrl}/api/v2/logs/search`)
      url.searchParams.set('query', dql)
      url.searchParams.set('entitySelector', `type(SERVICE),entityName.equals(${service})`)
      url.searchParams.set('from', 'now-1h')
      url.searchParams.set('limit', String(limit))

      const res = await fetch(url.toString(), { headers: authHeaders(conn.token) })
      if (!res.ok) throw new Error(`Dynatrace get_logs failed: HTTP ${res.status}`)

      const json = (await res.json()) as {
        results?: Array<{ timestamp: number; status: string; content: string }>
      }
      const results = json.results ?? []

      return {
        lines: results.map(r => ({
          ts: new Date(toEpochMs(r.timestamp)).toISOString(),
          level: r.status ?? 'INFO',
          msg: r.content ?? '',
        })),
      }
    },
    write: false,
  },
]

export class DynatraceAgent implements IConnectorAgent {
  readonly connectorType = 'dynatrace'
  readonly tools = TOOLS
}
