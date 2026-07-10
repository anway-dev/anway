import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface CoralogixCreds { baseUrl: string; apiKey: string; region: string }

/**
 * Extract credentials matching bootstrap.ts auth model:
 * - apiKey from payload['apiKey'] ?? payload['token']
 * - region from payload['region'] (default 'us1')
 * - baseUrl defaults to the docs-verified unified regional scheme
 *   'https://api.{region}.coralogix.com' (us1/us2/eu1/eu2/ap1/ap2/ap3).
 *   The previous default (ng-api-http.{region}.coralogix.com) mixed the
 *   legacy host prefix with the new region-domain scheme — a hostname that
 *   exists in neither generation.
 */
function extractCreds(creds: Record<string, unknown>): CoralogixCreds | null {
  const apiKey = (creds['apiKey'] as string | undefined) ?? (creds['token'] as string | undefined)
  if (!apiKey) return null
  const region = (creds['region'] as string | undefined) ?? 'us1'
  const baseUrl = (creds['baseUrl'] as string | undefined) ?? `https://api.${region}.coralogix.com`
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, region }
}

/** Parse window string like '1h', '30m', '24h', '7d' into milliseconds. */
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
 * Compute a DataPrime timeslice interval string from window duration.
 * Shorter windows → finer buckets.
 */
function intervalForWindow(ms: number): string {
  if (ms <= 300_000) return '1m'          // ≤5min
  if (ms <= 3_600_000) return '5m'         // ≤1h
  if (ms <= 21_600_000) return '15m'       // ≤6h
  if (ms <= 86_400_000) return '1h'        // ≤24h
  return '1d'                               // >24h
}

// ─────────────────────────────────────────────────────────────────────────────
// API design decisions (documented per-tool below):
//
// Coralogix exposes two main query surfaces:
//   1. DataPrime (POST /api/v1/dataprime/query) — unified query language for
//      logs and metrics. Accepts a Lucene/Coralogix-QL query string, time range,
//      and optional limit. Returns structured results.
//   2. Alert Definitions (GET /api/v1/alert-definitions) — dedicated REST
//      endpoint listing configured alerts with name, severity, enabled status,
//      and last-triggered timestamp.
//
// Why DataPrime for both logs AND metrics:
//   Coralogix's architecture treats all observability data as queryable event
//   streams through one query engine. Metrics are ingested as log events with
//   numeric metadata fields — DataPrime's `timeslice` + `stats` operators can
//   produce timeseries buckets directly. A separate Prometheus-compatible
//   endpoint exists (/api/v1/prometheus) but requires a different auth model
//   (API key with metrics scope) and is less consistent with the bootstrap
//   pattern already using POST /api/v1/... on the ng-api-http base URL.
//   DataPrime is the correct single surface for both.
//
// Why Alert Definitions REST endpoint for alerts (not DataPrime):
//   Coralogix alert-definitions API directly returns the configured-alert
//   catalog with severity, enabled status, and last-triggered-at. Querying for
//   "active alerts" via DataPrime (looking for alert-triggered log events) is
//   possible but fragile — it depends on each alert being configured to emit
//   such events. The REST endpoint is the canonical source of truth for "what
//   alerts exist and are they firing."
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS: ConnectorTool[] = [
  // ── get_metrics ──────────────────────────────────────────────────────────
  //
  // Real DataPrime query against the metrics event stream.
  //
  // Query construction:
  //   source metrics
  //   | filter metadata_applicationName = '<service>'
  //   | timeslice <interval>
  //   | stats avg(metadata_value) by timeslice
  //
  // Window → DataPrime time-range mapping:
  //   parse window string (e.g. '1h', '30m') → compute startTime = now - window
  //   endTime = now. Both sent as ISO 8601 strings in the request body.
  //
  // Response shape (mapped to existing {t, v} contract):
  //   DataPrime returns results[] with timeslice buckets.
  //   Each bucket mapped to { t: timestamp_ms, v: numeric_value }.
  {
    definition: {
      name: 'get_metrics',
      description: 'Fetch metrics for a service via DataPrime timeslice aggregation on the metrics event stream',
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
    // a real Coralogix outage/auth failure as "no metrics". Throws now; a
    // genuine 200-OK-with-zero-datapoints result is unaffected.
    execute: async (params, creds) => {
      const c = extractCreds(creds)
      if (!c) throw new Error('Coralogix credentials not configured')

      const service = String(params.service ?? '').trim()
      if (!service) throw new Error('Coralogix get_metrics: service is required')

      const windowMs = parseWindowMs(String(params.window ?? '1h'))
      const interval = intervalForWindow(windowMs)
      const metricField = typeof params.metric === 'string' && params.metric.trim()
        ? params.metric.trim()
        : 'value'
      const now = new Date()
      const startTime = new Date(now.getTime() - windowMs).toISOString()
      const endTime = now.toISOString()

      const query = [
        'source metrics',
        `| filter metadata_applicationName = '${service.replace(/'/g, "\\'")}'`,
        `| timeslice ${interval}`,
        `| stats avg(metadata_${metricField}) by timeslice`,
      ].join(' ')

      const res = await fetch(`${c.baseUrl}/api/v1/dataprime/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, startTime, endTime }),
      })
      if (!res.ok) throw new Error(`Coralogix get_metrics failed: HTTP ${res.status}`)

      const data = (await res.json()) as {
        results?: Array<Record<string, unknown>>
      }

      const results = data.results ?? []
      const points = results
        .map(r => {
          const tsField = r['timeslice'] as string | undefined
          const valField = r[`avg(metadata_${metricField})`] ?? r['avg(metadata_value)'] ?? r['value']
          if (!tsField) return null
          const t = new Date(tsField).getTime()
          const v = typeof valField === 'number' ? valField : parseFloat(String(valField))
          if (isNaN(v)) return null
          return { t, v }
        })
        .filter((p): p is { t: number; v: number } => p !== null)

      return { points, unit: 'requests/s' }
    },
    write: false,
  },

  // ── get_alerts ───────────────────────────────────────────────────────────
  //
  // Real call to GET /api/v1/alert-definitions.
  //
  // Why this endpoint (not DataPrime):
  //   Coralogix alert-definitions is the authoritative source for configured
  //   alerts. It returns alert name, severity, enabled status, and
  //   last-triggered-at per alert. DataPrime could be used to query for
  //   alert-triggered log events, but that requires each alert to emit such
  //   events — not guaranteed. The REST endpoint is canonical.
  //
  // Service filtering: matched against alert name, description, and labels
  //   (case-insensitive substring). No server-side service filter exists on
  //   this endpoint, so filtering is client-side.
  //
  // Severity filtering: matched against alert severity field (case-insensitive).
  //
  // Status mapping:
  //   - enabled=true + has recent lastTriggered → 'firing'
  //   - enabled=true but no recent trigger → 'ok'
  //   - enabled=false → 'disabled'
  //
  // firedAt: alert.lastTriggeredAt or alert.updatedAt
  {
    definition: {
      name: 'get_alerts',
      description:
        'List active Coralogix alerts. Service/severity filters applied client-side — the alert-definitions endpoint has no server-side service filter.',
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
      const c = extractCreds(creds)
      if (!c) throw new Error('Coralogix credentials not configured')

      const serviceFilter = typeof params.service === 'string'
        ? (params.service as string).toLowerCase()
        : null
      const severityFilter = typeof params.severity === 'string'
        ? (params.severity as string).toLowerCase()
        : null

      // Docs-verified path (docs.coralogix.com/api-reference/v3): the Alert
      // Definitions v3 REST service lives under /mgmt/openapi/3 with list
      // endpoint /alerts/alerts-general/v3/alert-defs. The previous
      // /api/v1/alert-definitions path was fixture-authored fiction — no
      // such endpoint exists in the Coralogix API surface.
      const res = await fetch(`${c.baseUrl}/mgmt/openapi/3/alerts/alerts-general/v3/alert-defs`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${c.apiKey}`,
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) throw new Error(`Coralogix get_alerts failed: HTTP ${res.status}`)

      interface AlertDefProps {
        name?: string
        description?: string
        priority?: string
        enabled?: boolean
        entityLabels?: Record<string, string>
      }
      interface AlertDef {
        id?: string
        alertDefProperties?: AlertDefProps
        createdTime?: string
        updatedTime?: string
        lastTriggeredTime?: string
      }
      // gRPC-gateway JSON uses camelCase (alertDefs); tolerate snake_case too.
      const data = (await res.json()) as { alertDefs?: AlertDef[]; alert_defs?: AlertDef[] }
      const defs = data.alertDefs ?? data.alert_defs ?? []

      const alerts = defs
        .map(d => {
          const props = d.alertDefProperties ?? {}
          const title = props.name ?? d.id ?? 'unnamed-alert'
          // v3 uses priority P1..P5 — map to conventional severities.
          const priority = (props.priority ?? '').toUpperCase()
          const severity = priority.includes('P1') ? 'critical'
            : priority.includes('P2') ? 'error'
            : priority.includes('P3') ? 'warning'
            : 'info'
          const enabled = props.enabled !== false
          const status = enabled ? 'firing' : 'disabled'
          const firedAt = d.lastTriggeredTime ?? d.updatedTime ?? d.createdTime ?? new Date().toISOString()

          return { id: d.id ?? title, title, severity, status, firedAt }
        })
        .filter(a => {
          if (serviceFilter) {
            const haystack = `${a.title} ${a.id}`.toLowerCase()
            if (!haystack.includes(serviceFilter)) return false
          }
          if (severityFilter && a.severity !== severityFilter) return false
          return true
        })

      return { alerts }
    },
    write: false,
  },

  // ── get_logs ─────────────────────────────────────────────────────────────
  //
  // Real DataPrime query against the logs event stream.
  //
  // Query construction:
  //   source logs
  //   | filter applicationName = '<service>'
  //   | filter text contains '<query>'
  //   | limit <limit>
  //
  // Default limit: 50. Coralogix DataPrime supports a top-level LIMIT clause
  //   as well as a `limit` parameter in the request body.
  //
  // Response shape (mapped to existing {ts, level, msg} contract):
  //   DataPrime returns results[] with timestamp, severity, text fields.
  {
    definition: {
      name: 'get_logs',
      description: 'Search logs for a service via DataPrime query against the logs event stream',
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
      const c = extractCreds(creds)
      if (!c) throw new Error('Coralogix credentials not configured')

      const service = String(params.service ?? '').trim()
      if (!service) throw new Error('Coralogix get_logs: service is required')

      const query = String(params.query ?? '').trim()
      const limit = typeof params.limit === 'number' ? (params.limit as number) : 50

      const dpQuery = [
        'source logs',
        `| filter applicationName = '${service.replace(/'/g, "\\'")}'`,
        `| filter text contains '${query.replace(/'/g, "\\'")}'`,
        `| limit ${limit}`,
      ].join(' ')

      const now = new Date()
      const startTime = new Date(now.getTime() - 86_400_000).toISOString() // last 24h default

      const res = await fetch(`${c.baseUrl}/api/v1/dataprime/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: dpQuery, startTime, endTime: now.toISOString(), limit }),
      })
      if (!res.ok) throw new Error(`Coralogix get_logs failed: HTTP ${res.status}`)

      const data = (await res.json()) as {
        results?: Array<{
          timestamp?: string
          severity?: string
          text?: string
          message?: string
          metadata?: Record<string, unknown>
        }>
      }

      const results = data.results ?? []
      const lines = results.map(r => ({
        ts: r.timestamp ?? new Date().toISOString(),
        level: (r.severity ?? 'info').toLowerCase(),
        msg: r.text ?? r.message ?? '',
      }))

      return { lines }
    },
    write: false,
  },
]

export class CoralogixAgent implements IConnectorAgent {
  readonly connectorType = 'coralogix'
  readonly tools = TOOLS
}
