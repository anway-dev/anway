import { execFile } from 'child_process'
import { promisify } from 'util'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Helpers — awsEnv + runAws, using execFile with an argument array (not a
// shell string) so tool-call parameters (LLM-reachable, unlike bootstrap.ts's
// API-response-only values) can never be interpreted as shell metacharacters.
// ---------------------------------------------------------------------------

function awsEnv(creds: Record<string, unknown>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (creds['accessKeyId']) env['AWS_ACCESS_KEY_ID'] = String(creds['accessKeyId'])
  if (creds['secretAccessKey']) env['AWS_SECRET_ACCESS_KEY'] = String(creds['secretAccessKey'])
  if (creds['sessionToken']) env['AWS_SESSION_TOKEN'] = String(creds['sessionToken'])
  env['AWS_DEFAULT_REGION'] =
    (creds['region'] as string) ??
    process.env['AWS_DEFAULT_REGION'] ??
    'us-east-1'
  // Optional endpoint override (e.g. LocalStack) — aws CLI v2.13+ reads this
  // natively, no argv changes needed. Absent in production; only set for
  // local/test environments pointing at an AWS-API-compatible emulator.
  if (creds['endpointUrl']) env['AWS_ENDPOINT_URL'] = String(creds['endpointUrl'])
  return env
}

async function runAws(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync('aws', [...args, '--output', 'json'], { env, timeout: 30000 })
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

/** Parse a human-readable window like "1h", "30m", "5m" into milliseconds. */
function parseWindowMs(window: string): number {
  const m = window.match(/^(\d+)\s*(h|m|s)$/)
  if (!m) return 3_600_000 // default 1h
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
//
// Scope-fit reasoning:
//   get_health_events → aws health describe-events   — core AWS Health API
//   get_alarms        → aws cloudwatch describe-alarms — alarms ARE health signals
//   get_cloud_metrics → aws cloudwatch get-metric-statistics — metrics ARE vital signs
//
// All three implemented as real AWS CLI calls. No stubs. Metrics and alarms
// complement the unique health-events data; together they give a complete
// cloud-health picture. Mirrors aws-cloudwatch's execSync + env-var convention.
// ---------------------------------------------------------------------------

const TOOLS: ConnectorTool[] = [
  // -- get_cloud_metrics ----------------------------------------------------
  {
    definition: {
      name: 'get_cloud_metrics',
      description:
        'Fetch CloudWatch metric statistics for a resource. ' +
        'Uses namespace AWS/EC2 and dimension InstanceId={resource} by default.',
      parameters: {
        type: 'object',
        properties: {
          resource: { type: 'string', description: 'Resource identifier (e.g., EC2 instance ID)' },
          metric:   { type: 'string', description: 'CloudWatch metric name (e.g., CPUUtilization)' },
          window:   { type: 'string', description: 'Time window like "1h", "30m", "5m"' },
        },
        required: ['resource', 'metric', 'window'],
      },
    },
    execute: async (params, creds) => {
      const resource   = String(params.resource)
      const metric     = String(params.metric)
      const windowStr  = String(params.window)
      const env = awsEnv(creds)

      const endTime   = new Date()
      const startTime = new Date(endTime.getTime() - parseWindowMs(windowStr))

      const r = await runAws(
        [
          'cloudwatch', 'get-metric-statistics',
          '--namespace', 'AWS/EC2',
          '--metric-name', metric,
          '--dimensions', `Name=InstanceId,Value=${resource}`,
          '--start-time', startTime.toISOString(),
          '--end-time', endTime.toISOString(),
          '--period', '300',
          '--statistics', 'Average',
        ],
        env,
      )

      if (!r || typeof r !== 'object') return { points: [] }
      const data = r as {
        Datapoints?: Array<{ Timestamp: string; Average: number; Unit?: string }>
      }
      const points = (data.Datapoints ?? [])
        .filter(dp => dp.Average != null)
        .map(dp => ({ t: new Date(dp.Timestamp).getTime(), v: dp.Average }))
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
        'List CloudWatch alarms. Optionally filter by service name prefix ' +
        '(maps to --alarm-name-prefix). Alarms are health signals — a health ' +
        'connector without alarm visibility is incomplete.',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            optional: true,
            description: 'Optional alarm name prefix filter',
          },
        },
      },
    },
    execute: async (params, creds) => {
      const env = awsEnv(creds)
      const args = ['cloudwatch', 'describe-alarms']
      if (params.service) args.push('--alarm-name-prefix', String(params.service))

      const r = await runAws(args, env)
      if (!r || typeof r !== 'object') return { alarms: [] }
      const data = r as {
        MetricAlarms?: Array<{
          AlarmName: string
          StateValue: string
          StateReason: string
          AlarmDescription?: string
        }>
      }
      const alarms = (data.MetricAlarms ?? []).map(a => ({
        id:     a.AlarmName,
        name:   a.AlarmName,
        state:  a.StateValue,
        reason: a.StateReason ?? a.AlarmDescription ?? a.AlarmName,
      }))
      return { alarms }
    },
    write: false,
  },

  // -- get_health_events ----------------------------------------------------
  {
    definition: {
      name: 'get_health_events',
      description:
        'Get AWS Health events (Personal Health Dashboard). ' +
        'Calls aws health describe-events. Requires Business or Enterprise ' +
        'support plan — returns empty array if the account is not entitled.',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_params, creds) => {
      const env = awsEnv(creds)
      const r = await runAws(['health', 'describe-events'], env)
      if (!r || typeof r !== 'object') return { events: [] }
      const data = r as {
        events?: Array<{
          arn?: string
          service?: string
          region?: string
          statusCode?: string
          eventTypeCode?: string
          startTime?: string
          endTime?: string
          eventDescription?: { latestDescription?: string }
        }>
      }
      const events = (data.events ?? []).map(e => ({
        service: e.service ?? 'Unknown',
        region:  e.region ?? 'global',
        status:  e.statusCode ?? 'unknown',
        message: e.eventDescription?.latestDescription ?? e.eventTypeCode ?? 'No description',
      }))
      return { events }
    },
    write: false,
  },
]

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class AwsHealthAgent implements IConnectorAgent {
  readonly connectorType = 'aws-health'
  readonly tools = TOOLS
}
