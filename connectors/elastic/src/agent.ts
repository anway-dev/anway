import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface ElasticCreds { baseUrl: string; headers: Record<string, string> }

/**
 * Extract credentials matching bootstrap.ts auth model:
 * - Bearer token (payload['token'] ?? payload['apiKey'])
 * - Basic user:password (payload['user'] / payload['password'])
 * - Unauthenticated fallback (no auth header)
 */
function extractCreds(creds: Record<string, unknown>): ElasticCreds | null {
  const baseUrl = (creds['baseUrl'] as string | undefined) ?? 'http://localhost:9200'
  const user = (creds['user'] as string | undefined) ?? ''
  const password = (creds['password'] as string | undefined) ?? ''
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else if (user && password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), headers }
}

/** Parse a window string like '1h', '30m', '24h', '7d' into milliseconds. */
function parseWindowMs(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 3_600_000 // default 1h
  const n = parseInt(match[1]!, 10)
  switch (match[2]) {
    case 's': return n * 1000
    case 'm': return n * 60_000
    case 'h': return n * 3_600_000
    case 'd': return n * 86_400_000
    default: return 3_600_000
  }
}

/**
 * Auto-compute a date histogram interval from the window duration.
 * Shorter windows → finer buckets.
 */
function intervalForWindow(ms: number): string {
  if (ms <= 3_600_000) return '1m'        // ≤1h
  if (ms <= 21_600_000) return '5m'        // ≤6h
  if (ms <= 86_400_000) return '15m'       // ≤24h
  if (ms <= 604_800_000) return '1h'       // ≤7d
  return '1d'                               // >7d
}

const TOOLS: ConnectorTool[] = [
  // ── get_metrics — date histogram aggregation on a metrics index ─────
  //
  // Elasticsearch is not a native metrics timeseries store, but many orgs
  // ship APM / metrics beats into ES indices. The closest real equivalent
  // to a "get metrics for a service" query is a date histogram aggregation
  // on a metrics-patterned index.
  //
  // Index convention: 'metrics-*' (covers metrics-YYYY.MM, metrics-* beats, etc.)
  // Aggregation field: `metric` param (defaults to 'value')
  // Aggregation type: avg per bucket
  // Time range: derived from `window` param
  {
    definition: {
      name: 'get_metrics',
      description: 'Fetch metrics for a service via date histogram aggregation on metrics-*',
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
      const c = extractCreds(creds)
      if (!c) return { points: [], unit: 'value' }

      const service = String(params.service ?? '').trim()
      if (!service) return { points: [], unit: 'value' }

      const windowMs = parseWindowMs(String(params.window ?? '1h'))
      const interval = intervalForWindow(windowMs)
      const metricField = typeof params.metric === 'string' && params.metric.trim()
        ? params.metric.trim()
        : 'value'
      const now = Date.now()
      const gte = new Date(now - windowMs).toISOString()

      try {
        const body = {
          size: 0,
          query: {
            bool: {
              filter: [
                { term: { 'service.name': service } },
                { range: { '@timestamp': { gte, lte: new Date(now).toISOString() } } },
              ],
            },
          },
          aggs: {
            metrics_over_time: {
              date_histogram: {
                field: '@timestamp',
                fixed_interval: interval,
                min_doc_count: 0,
                extended_bounds: { min: new Date(now - windowMs).getTime(), max: now },
              },
              aggs: {
                avg_value: { avg: { field: metricField } },
              },
            },
          },
        }

        const res = await fetch(`${c.baseUrl}/metrics-*/_search`, {
          method: 'POST',
          headers: c.headers,
          body: JSON.stringify(body),
        })
        if (!res.ok) return { points: [], unit: 'value' }

        const data = (await res.json()) as {
          aggregations?: {
            metrics_over_time?: {
              buckets: Array<{ key: number; avg_value: { value: number | null } }>
            }
          }
        }

        const buckets = data.aggregations?.metrics_over_time?.buckets ?? []
        const points = buckets
          .filter(b => b.avg_value.value != null)
          .map(b => ({ t: b.key, v: b.avg_value.value! }))

        // Derive a plausible unit from the metric field name
        let unit = 'value'
        if (metricField.includes('bytes') || metricField.includes('size')) unit = 'bytes'
        else if (metricField.includes('duration') || metricField.includes('latency')) unit = 'ms'
        else if (metricField.includes('rate') || metricField.includes('per_sec')) unit = 'per_sec'
        else if (metricField.includes('count')) unit = 'count'

        return { points, unit }
      } catch {
        return { points: [], unit: 'value' }
      }
    },
    write: false,
  },

  // ── get_alerts — Watcher API (plain Elasticsearch, no Kibana) ────────
  //
  // Kibana's Alerting API requires Kibana. For plain self-managed
  // Elasticsearch, the native alerting mechanism is Watcher.
  //
  // GET /_watcher/watch returns all configured watches with their
  // execution status (state, last_triggered, last_execution).
  //
  // Severity mapping (ES Watcher has no native severity field):
  //   - Has actions + last execution failed  → 'critical'
  //   - Has actions + watch is active         → 'warning'
  //   - No actions or inactive               → 'info'
  // Status mapping:
  //   - state 'executed' / 'active'           → 'firing' (watch is live)
  //   - state 'inactive'                      → 'resolved'
  //   - other                                 → 'unknown'
  // firedAt: watch.status.last_triggered or last_execution timestamp
  {
    definition: {
      name: 'get_alerts',
      description: 'List active Watcher watches (native Elasticsearch alerting, no Kibana)',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', optional: true },
          severity: { type: 'string', optional: true },
        },
      },
    },
    execute: async (params, creds) => {
      const c = extractCreds(creds)
      if (!c) return { alerts: [] }

      const serviceFilter = typeof params.service === 'string'
        ? (params.service as string).toLowerCase()
        : null
      const severityFilter = typeof params.severity === 'string'
        ? (params.severity as string).toLowerCase()
        : null

      try {
        const res = await fetch(`${c.baseUrl}/_watcher/watch`, {
          method: 'GET',
          headers: c.headers,
        })
        if (!res.ok) return { alerts: [] }

        const data = (await res.json()) as {
          watches?: Array<{
            _id: string
            status?: {
              state?: string
              last_triggered?: string
              last_execution?: { successful?: boolean; timestamp?: string }
            }
            metadata?: { name?: string; severity?: string }
            actions?: Record<string, unknown>
          }>
        }

        const watches = data.watches ?? []

        const alerts = watches
          .map(w => {
            const state = w.status?.state ?? 'unknown'
            const hasActions = w.actions != null && Object.keys(w.actions).length > 0
            const lastExecFailed = w.status?.last_execution?.successful === false
            const title = w.metadata?.name ?? w._id

            // Derive severity
            let severity: string
            if (w.metadata?.severity) {
              severity = w.metadata.severity.toLowerCase()
            } else if (hasActions && lastExecFailed) {
              severity = 'critical'
            } else if (hasActions) {
              severity = 'warning'
            } else {
              severity = 'info'
            }

            // Derive status from watch state
            let status: string
            switch (state) {
              case 'active':
              case 'executed':
                status = 'firing'
                break
              case 'inactive':
                status = 'resolved'
                break
              default:
                status = state
            }

            const firedAt = w.status?.last_triggered
              ?? w.status?.last_execution?.timestamp
              ?? new Date().toISOString()

            return { id: w._id, title, severity, status, firedAt }
          })
          .filter(a => {
            if (serviceFilter && !a.title.toLowerCase().includes(serviceFilter) && !a.id.toLowerCase().includes(serviceFilter)) return false
            if (severityFilter && a.severity !== severityFilter) return false
            return true
          })

        return { alerts }
      } catch {
        return { alerts: [] }
      }
    },
    write: false,
  },

  // ── get_logs — search a log index with Query DSL ────────────────────
  //
  // Standard Elasticsearch log search: POST /{index}/_search with a
  // bool query combining a match on the service field and a query_string
  // or match on the message field. Sorted by @timestamp descending.
  //
  // Index convention: 'logs-*' (covers logs-YYYY.MM.DD, filebeat-*, etc.)
  // Default limit: 50
  // Returns hits mapped to { ts, level, msg } from _source fields.
  {
    definition: {
      name: 'get_logs',
      description: 'Search logs for a service via Elasticsearch Query DSL on logs-*',
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
      const c = extractCreds(creds)
      if (!c) return { lines: [] }

      const service = String(params.service ?? '').trim()
      if (!service) return { lines: [] }

      const query = String(params.query ?? '').trim()
      const limit = typeof params.limit === 'number' ? (params.limit as number) : 50

      try {
        const body = {
          size: limit,
          query: {
            bool: {
              must: [
                { term: { 'service.name': service } },
                {
                  query_string: {
                    query: query || '*',
                    default_field: 'message',
                  },
                },
              ],
            },
          },
          sort: [{ '@timestamp': { order: 'desc' as const } }],
        }

        const res = await fetch(`${c.baseUrl}/logs-*/_search`, {
          method: 'POST',
          headers: c.headers,
          body: JSON.stringify(body),
        })
        if (!res.ok) return { lines: [] }

        const data = (await res.json()) as {
          hits?: {
            hits?: Array<{
              _source?: {
                '@timestamp'?: string
                level?: string
                'log.level'?: string
                severity?: string
                message?: string
                msg?: string
                'log.message'?: string
              }
            }>
          }
        }

        const hits = data.hits?.hits ?? []
        const lines = hits.map(h => {
          const src = h._source ?? {}
          return {
            ts: src['@timestamp'] ?? new Date().toISOString(),
            level: src.level ?? src['log.level'] ?? src.severity ?? 'info',
            msg: src.message ?? src.msg ?? src['log.message'] ?? '',
          }
        })

        return { lines }
      } catch {
        return { lines: [] }
      }
    },
    write: false,
  },
]

export class ElasticAgent implements IConnectorAgent {
  readonly connectorType = 'elastic'
  readonly tools = TOOLS
}
