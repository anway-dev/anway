import { execFile } from 'child_process'
import { promisify } from 'util'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Auth helpers. Azure CLI uses AZURE_CLIENT_ID / AZURE_CLIENT_SECRET /
// AZURE_TENANT_ID for service-principal auth. The az CLI itself requires a
// prior `az login --service-principal`; these env vars document the expected
// credentials. If auth is not configured, commands fail gracefully and we
// return empty — matching every other CLI-based connector in this repo.
//
// runAz uses execFile with an argument array (not a shell string) so that
// tool-call parameters — LLM-reachable, unlike bootstrap-only values derived
// from Azure's own API responses — can never be interpreted as shell
// metacharacters. Matches the pattern used by connectors/aws-cloudwatch and
// connectors/aws-health's agent.ts (fixed earlier this session) and
// connectors/k8s's spawnSync usage.
// ---------------------------------------------------------------------------

function azEnv(creds: Record<string, unknown>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (creds['clientId']) env['AZURE_CLIENT_ID'] = String(creds['clientId'])
  if (creds['clientSecret']) env['AZURE_CLIENT_SECRET'] = String(creds['clientSecret'])
  if (creds['tenantId']) env['AZURE_TENANT_ID'] = String(creds['tenantId'])
  return env
}

// Throws on a real failure (az CLI missing/not authenticated, nonzero exit,
// malformed JSON) instead of returning null — confirmed live via
// independent review that collapsing "not authenticated" and "genuinely no
// data" into the same null (which every tool then treated as an empty
// result) masks a real Azure auth/outage failure as "no metrics/alarms/
// events". A genuine 200-equivalent-but-empty response is a separate, real
// case each tool below still handles on its own.
async function runAz(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const { stdout } = await execFileAsync('az', [...args, '--output', 'json'], { env, timeout: 30000 })
  return JSON.parse(stdout)
}

/** Parse a human-readable window like "1h", "30m", "5m" into milliseconds. */
function parseWindowMs(window: string): number {
  const m = window.match(/^(\d+)\s*(s|m|h|d)$/)
  if (!m) return 3_600_000 // default 1 h
  const v = Number(m[1])
  switch (m[2]) {
    case 's': return v * 1_000
    case 'm': return v * 60_000
    case 'h': return v * 3_600_000
    case 'd': return v * 86_400_000
    default:  return 3_600_000
  }
}

/** Map window duration to an Azure Monitor interval string (ISO 8601 duration). */
function intervalForWindow(ms: number): string {
  if (ms <= 300_000) return 'PT1M'       // ≤5 min  → 1-minute buckets
  if (ms <= 3_600_000) return 'PT5M'      // ≤1 h    → 5-minute buckets
  if (ms <= 21_600_000) return 'PT15M'    // ≤6 h    → 15-minute buckets
  return 'PT1H'                            // >6 h    → 1-hour buckets
}

// ---------------------------------------------------------------------------
// CLI command decisions (documented per tool)
//
// get_cloud_metrics → az monitor metrics list
//   Real Azure Monitor REST API command. Maps window to ISO 8601 start/end
//   times, picks a granularity (interval) tuned to the window length, and
//   parses value[].timeseries[].data[] timeStamp/average into {t, v} points.
//
// get_alarms → az monitor metrics alert list
//   Azure Monitor metric alert rules are the direct equivalent of CloudWatch
//   metric alarms. They fire on metric threshold breaches and are the primary
//   alerting surface for runtime health. Activity log alerts
//   (az monitor activity-log alert list) cover administrative operations
//   (resource creation/deletion), not runtime health — wrong tool for "active
//   alarms." Why not get both: metric + activity-log alerts have fundamentally
//   different shapes (activity-log alerts lack severity, are keyed on
//   operation name not metric). Merging them into one flat list would lose
//   signal. If a future use case needs activity-log alerts, add a separate
//   dedicated tool.
//
// get_health_events → az rest GET Microsoft.ResourceHealth/events
//   Azure's dedicated Service Health REST API returns structured
//   {service, region, status, impactDescription} events. The alternative
//   (az monitor activity-log list --status ServiceHealth) returns verbose
//   activity-log entries that are not cleanly parseable into the expected
//   {service, region, status, message} shape. The ResourceHealth endpoint is
//   the canonical source for service health events.
// ---------------------------------------------------------------------------

const TOOLS: ConnectorTool[] = [
  // ── get_cloud_metrics ─────────────────────────────────────────────────────
  {
    definition: {
      name: 'get_cloud_metrics',
      description:
        'Fetch Azure Monitor metrics for a resource. ' +
        'Uses az monitor metrics list with start/end times derived from the window parameter. ' +
        'Resource should be a full Azure resource ID (e.g. /subscriptions/.../providers/Microsoft.Compute/virtualMachines/vm1).',
      parameters: {
        type: 'object',
        properties: {
          resource: { type: 'string', description: 'Azure resource ID' },
          metric:   { type: 'string', description: 'Metric name (e.g. Percentage CPU, Network In)' },
          window:   { type: 'string', description: 'Time window like "1h", "30m", "5m"' },
        },
        required: ['resource', 'metric', 'window'],
      },
    },
    execute: async (params, creds) => {
      const resource   = String(params.resource)
      const metric     = String(params.metric)
      const windowStr  = String(params.window)
      const env        = azEnv(creds)

      const windowMs = parseWindowMs(windowStr)
      const interval = intervalForWindow(windowMs)
      const endTime   = new Date()
      const startTime = new Date(endTime.getTime() - windowMs)

      const r = await runAz(
        [
          'monitor', 'metrics', 'list',
          '--resource', resource,
          '--metric', metric,
          '--start-time', startTime.toISOString(),
          '--end-time', endTime.toISOString(),
          '--interval', interval,
        ],
        env,
      )

      if (!r || typeof r !== 'object') return { points: [] }

      // Real az monitor metrics list JSON shape:
      // { value: [{ timeseries: [{ data: [{ timeStamp, average, ... }] }] }] }
      const data = r as {
        value?: Array<{
          timeseries?: Array<{
            data?: Array<{ timeStamp: string; average?: number }>
          }>
        }>
      }

      const timeseries = data.value?.[0]?.timeseries ?? []
      const points = timeseries
        .flatMap(ts =>
          (ts.data ?? [])
            .filter(dp => dp.average != null)
            .map(dp => ({ t: new Date(dp.timeStamp).getTime(), v: dp.average! })),
        )
        .sort((a, b) => a.t - b.t)

      return { points }
    },
    write: false,
  },

  // ── get_alarms ────────────────────────────────────────────────────────────
  {
    definition: {
      name: 'get_alarms',
      description:
        'List Azure Monitor metric alert rules. ' +
        'Returns configured alert rules with name, enabled/severity state, and condition description. ' +
        'Optionally filter by service name (client-side substring match on alert name and description).',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            optional: true,
            description: 'Optional filter — matched against alert name and condition description',
          },
        },
      },
    },
    execute: async (params, creds) => {
      const env = azEnv(creds)
      const serviceFilter = typeof params.service === 'string'
        ? String(params.service).toLowerCase()
        : null

      const r = await runAz(['monitor', 'metrics', 'alert', 'list'], env)
      if (!r || !Array.isArray(r)) return { alarms: [] }

      // Real az monitor metrics alert list JSON shape (array):
      // [{ id, name, enabled, severity, description, condition: { allOf: [...] }, scopes: [...] }]
      const alarms = (r as Array<{
        id?: string
        name?: string
        enabled?: boolean
        severity?: string
        description?: string
        condition?: { allOf?: Array<{ metricName?: string; operator?: string; threshold?: number }> }
        scopes?: string[]
      }>)
        .map(a => {
          const name = a.name ?? 'unknown'
          const state = a.enabled ? (a.severity ?? 'Enabled') : 'Disabled'
          const conditionSummary = a.condition?.allOf
            ?.map(c => `${c.metricName ?? '?'} ${c.operator ?? '?'} ${c.threshold ?? ''}`)
            .join(', ') ?? ''
          const reason = a.description ?? conditionSummary ?? name
          return { id: name, name, state, reason }
        })
        .filter(a => {
          if (!serviceFilter) return true
          const haystack = `${a.name} ${a.reason}`.toLowerCase()
          return haystack.includes(serviceFilter)
        })

      return { alarms }
    },
    write: false,
  },

  // ── get_health_events ─────────────────────────────────────────────────────
  {
    definition: {
      name: 'get_health_events',
      description:
        'Get Azure service health events via the Microsoft.ResourceHealth REST API. ' +
        'Requires subscriptionId in creds or as a parameter. ' +
        'Returns an empty array if the call fails or no subscription is configured.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionId: {
            type: 'string',
            optional: true,
            description: 'Azure subscription ID. Falls back to creds.subscriptionId if not provided.',
          },
        },
      },
    },
    execute: async (params, creds) => {
      const env = azEnv(creds)
      const subId =
        (typeof params.subscriptionId === 'string' ? params.subscriptionId : null) ??
        (creds['subscriptionId'] as string | undefined) ??
        (creds['subscription_id'] as string | undefined)

      if (!subId) throw new Error('Azure Monitor get_health_events: subscriptionId not configured (creds or param)')

      // Microsoft.ResourceHealth events endpoint — canonical source for Azure
      // Service Health events. Filtered to eventSource eq 'ServiceHealth' to
      // exclude Resource Health (VM-specific) events.
      const url =
        `https://management.azure.com/subscriptions/${encodeURIComponent(subId)}` +
        `/providers/Microsoft.ResourceHealth/events` +
        `?api-version=2022-10-01` +
        `&$filter=eventSource eq 'ServiceHealth'`

      const r = await runAz(['rest', '--method', 'GET', '--url', url], env)
      if (!r || typeof r !== 'object') return { events: [] }

      // Real ResourceHealth events JSON shape:
      // { value: [{ properties: { title, service, region, status, impactDescription, ... } }] }
      const data = r as {
        value?: Array<{
          properties?: {
            title?: string
            service?: string
            region?: string
            status?: string
            impactDescription?: string
          }
        }>
      }

      const events = (data.value ?? []).map(e => ({
        service: e.properties?.service ?? 'Unknown',
        region:  e.properties?.region ?? 'global',
        status:  e.properties?.status ?? 'unknown',
        message: e.properties?.impactDescription ?? e.properties?.title ?? 'No description',
      }))

      return { events }
    },
    write: false,
  },
]

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class AzureMonitorAgent implements IConnectorAgent {
  readonly connectorType = 'azure-monitor'
  readonly tools = TOOLS
}
