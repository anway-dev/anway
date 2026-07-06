import { execFile } from 'child_process'
import { promisify } from 'util'
import { tmpdir } from 'os'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Helpers
//
// runGcloud uses execFile with an argument array (not a shell string) so
// tool-call parameters (LLM-reachable, unlike bootstrap-only values) can
// never be interpreted as shell metacharacters. Matches the pattern used by
// connectors/aws-cloudwatch, connectors/aws-health, and connectors/azure-
// monitor's agent.ts (all fixed for the same reason this session).
// ---------------------------------------------------------------------------

function gcloudEnv(creds: Record<string, unknown>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  const keyFilePath = creds['google_application_credentials'] as string | undefined
  const rawKey = creds['service_account_key'] as string | object | undefined

  if (keyFilePath) {
    env['GOOGLE_APPLICATION_CREDENTIALS'] = keyFilePath
  } else if (rawKey) {
    const keyContent = typeof rawKey === 'string' ? rawKey : JSON.stringify(rawKey)
    const tmpFile = join(tmpdir(), `anway-gcp-key-${randomUUID()}.json`)
    writeFileSync(tmpFile, keyContent, { mode: 0o600 })
    env['GOOGLE_APPLICATION_CREDENTIALS'] = tmpFile
  }

  if (creds['project_id']) {
    env['CLOUDSDK_CORE_PROJECT'] = String(creds['project_id'])
  }

  return env
}

// Throws on a real failure (gcloud CLI missing/not authenticated, nonzero
// exit) instead of returning null — confirmed live via independent review
// that collapsing every real failure into null (which every tool then
// treated as an empty result) masks a real GCP auth/outage failure as "no
// metrics/alarms/events". The one legitimate exception (get_alarms's
// alpha incidents call, which is documented as allowed to fail and degrade
// gracefully) wraps its own call in a local try/catch below rather than
// relying on this function to swallow errors for everyone.
async function runGcloud(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const project = env['CLOUDSDK_CORE_PROJECT']
  const projArgs = project ? ['--project', project] : []
  const { stdout } = await execFileAsync(
    'gcloud',
    [...args, ...projArgs, '--format=json'],
    { env, timeout: 30000 },
  )
  return JSON.parse(stdout)
}

/** Parse a human-readable window like "1h", "30m", "5m" into milliseconds. */
function parseWindowMs(window: string): number {
  const m = window.match(/^(\d+)\s*(h|m|s)$/)
  if (!m) return 3_600_000 // default 1 h
  const v = Number(m[1])
  switch (m[2]) {
    case 'h': return v * 3_600_000
    case 'm': return v * 60_000
    case 's': return v * 1_000
    default:  return 3_600_000
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const TOOLS: ConnectorTool[] = [
  // -- get_cloud_metrics ----------------------------------------------------
  {
    definition: {
      name: 'get_cloud_metrics',
      description:
        'Fetch GCP Cloud Monitoring time series data for a resource. ' +
        'Uses gcloud monitoring time-series list with a filter expression. ' +
        'The metric param should be a full GCP metric type ' +
        '(e.g., "compute.googleapis.com/instance/cpu/utilization").',
      parameters: {
        type: 'object',
        properties: {
          resource: { type: 'string', description: 'Resource identifier (e.g., GCE instance ID — maps to resource.labels.instance_id)' },
          metric:   { type: 'string', description: 'Full GCP metric type (e.g., compute.googleapis.com/instance/cpu/utilization)' },
          window:   { type: 'string', description: 'Time window like "1h", "30m", "5m"' },
        },
        required: ['resource', 'metric', 'window'],
      },
    },
    execute: async (params, creds) => {
      const resource  = String(params.resource)
      const metric    = String(params.metric)
      const windowStr = String(params.window)
      const env = gcloudEnv(creds)

      const endTime   = new Date()
      const startTime = new Date(endTime.getTime() - parseWindowMs(windowStr))

      const filter = `metric.type="${metric}" AND resource.labels.instance_id="${resource}"`

      const r = await runGcloud(
        [
          'monitoring', 'time-series', 'list',
          '--filter', filter,
          '--interval-start-time', startTime.toISOString(),
          '--interval-end-time', endTime.toISOString(),
        ],
        env,
      )

      if (!Array.isArray(r)) return { points: [] }

      const timeSeriesList = r as Array<{
        points?: Array<{
          interval?: { endTime?: string }
          value?: { doubleValue?: number; int64Value?: string; boolValue?: boolean }
        }>
      }>

      const points = timeSeriesList
        .flatMap(ts => ts.points ?? [])
        .map(p => {
          const t = p.interval?.endTime ? new Date(p.interval.endTime).getTime() : Date.now()
          const v = p.value?.doubleValue
            ?? (p.value?.int64Value !== undefined ? Number(p.value.int64Value) : undefined)
            ?? (p.value?.boolValue !== undefined ? (p.value.boolValue ? 1 : 0) : undefined)
            ?? 0
          return { t, v }
        })
        .sort((a, b) => a.t - b.t)
      return { points }
    },
    write: false,
  },

  // -- get_alarms -----------------------------------------------------------
  {
    definition: {
      name: 'get_alarms',
      description:
        'List GCP Cloud Monitoring alert policies and their current firing state. ' +
        'Uses gcloud monitoring policies list (stable GA) + ' +
        'gcloud alpha monitoring incidents list for firing state. ' +
        'Falls back to policy-only info if the incidents alpha command is unavailable.',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            optional: true,
            description: 'Optional filter on alert policy display name (substring match via gcloud --filter)',
          },
        },
      },
    },
    execute: async (params, creds) => {
      const env = gcloudEnv(creds)

      // Query alerting policies (stable GA command)
      const policyArgs = ['monitoring', 'policies', 'list']
      if (params.service) {
        policyArgs.push('--filter', `displayName~${String(params.service)}`)
      }

      const policiesR = await runGcloud(policyArgs, env)
      if (!Array.isArray(policiesR)) return { alarms: [] }

      const policies = policiesR as Array<{
        name?: string
        displayName?: string
        enabled?: boolean
        conditions?: Array<{
          displayName?: string
          conditionThreshold?: { thresholdValue?: number; filter?: string }
        }>
      }>

      // Try to get open incidents for firing state (alpha command, may fail —
      // this is the one intentional exception to runGcloud now throwing on
      // error: incidents are a real optional enrichment, not the primary
      // data this tool exists to return, so this call keeps its own local
      // try/catch instead of letting a real failure here take down the
      // whole tool.
      let incidentsR: unknown = null
      try {
        incidentsR = await runGcloud(
          ['alpha', 'monitoring', 'incidents', 'list', '--filter', 'state=open'],
          env,
        )
      } catch { /* optional enrichment — degrade gracefully */ }
      const incidents: Array<{ policyName?: string; state?: string; summary?: string }> =
        Array.isArray(incidentsR) ? incidentsR as typeof incidents : []

      const incidentByPolicy = new Map<string, { state: string; summary: string }>()
      for (const inc of incidents) {
        if (inc.policyName) {
          incidentByPolicy.set(inc.policyName, {
            state: inc.state ?? 'open',
            summary: inc.summary ?? 'No summary',
          })
        }
      }

      const alarms = policies.map(p => {
        const name = p.name ?? ''
        const displayName = p.displayName ?? name
        const incident = incidentByPolicy.get(name)
        const state = incident
          ? (incident.state === 'open' ? 'ALARM' : incident.state.toUpperCase())
          : p.enabled === false
            ? 'DISABLED'
            : 'OK'
        const reason = incident?.summary
          ?? (p.enabled === false ? 'Policy disabled' : p.conditions?.[0]?.displayName ?? 'No active incidents')

        return { id: name, name: displayName, state, reason }
      })

      return { alarms }
    },
    write: false,
  },

  // -- get_health_events ----------------------------------------------------
  {
    definition: {
      name: 'get_health_events',
      description:
        'Get Google Cloud service health events via the Personalized Service Health API. ' +
        'Uses gcloud auth print-access-token for authentication, then calls the REST API. ' +
        'Throws a real error if the API call fails, the Service Health API ' +
        'is not enabled, or no project is configured in credentials — ' +
        'rather than silently reporting no active events.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_params, creds) => {
      const env = gcloudEnv(creds)
      const project = env['CLOUDSDK_CORE_PROJECT']
      if (!project) throw new Error('GCP Monitoring get_health_events: no project configured in credentials')

      // Get OAuth access token via gcloud (execFile, no interpolated args —
      // this call takes no parameters at all, nothing to inject).
      const { stdout: tokenOut } = await execFileAsync(
        'gcloud', ['auth', 'print-access-token'], { env, timeout: 15000 },
      )
      const token = tokenOut.trim()
      if (!token) throw new Error('GCP Monitoring get_health_events: gcloud produced no access token')

      // Call Personalized Service Health API directly via fetch — no need
      // to shell out to curl for an authenticated HTTPS GET.
      // Endpoint: https://cloud.google.com/service-health/docs/reference/rest/v1/projects.locations.events/list
      const url = `https://servicehealth.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/events`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`GCP Monitoring get_health_events failed: HTTP ${res.status}`)
      const r = await res.json() as {
        events?: Array<{
          title?: string
          description?: string
          category?: string
          state?: string
          detailedState?: string
          affectedProducts?: string[]
          affectedLocations?: string[]
        }>
      }

      const events = (r.events ?? []).map(e => ({
        service: e.affectedProducts?.join(', ') ?? e.category ?? 'GCP',
        region:  e.affectedLocations?.join(', ') ?? 'global',
        status:  e.state ?? e.detailedState ?? 'unknown',
        message: e.description ?? e.title ?? 'No description',
      }))
      return { events }
    },
    write: false,
  },
]

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class GcpMonitoringAgent implements IConnectorAgent {
  readonly connectorType = 'gcp-monitoring'
  readonly tools = TOOLS
}
