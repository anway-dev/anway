import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AwsCloudwatchAgent } from './agent.js'

// ---------------------------------------------------------------------------
// Realistic AWS CLI JSON fixtures
// ---------------------------------------------------------------------------

const GET_METRICS_OUTPUT = {
  Datapoints: [
    { Timestamp: '2026-07-04T10:00:00Z', Average: 2.34, Unit: 'Percent' },
    { Timestamp: '2026-07-04T10:05:00Z', Average: 5.12, Unit: 'Percent' },
    { Timestamp: '2026-07-04T10:10:00Z', Average: 1.89, Unit: 'Percent' },
  ],
  Label: 'CPUUtilization',
}

const DESCRIBE_ALARMS_OUTPUT = {
  MetricAlarms: [
    {
      AlarmName: 'High-CPU-alarm',
      StateValue: 'ALARM',
      StateReason: 'Threshold Crossed: 1 datapoint (85.5) was >= 80.0',
      AlarmDescription: 'Alarm when CPU exceeds 80%',
    },
    {
      AlarmName: 'Low-Memory-alarm',
      StateValue: 'OK',
      StateReason: 'Threshold Crossed: 1 datapoint (45.2) was not >= 70.0',
      AlarmDescription: 'Alarm when memory drops below 20%',
    },
  ],
}

const HEALTH_EVENTS_OUTPUT = {
  events: [
    {
      arn: 'arn:aws:health:us-east-1::event/EC2/AWS_EC2_NETWORK_ISSUE/abc123',
      service: 'EC2',
      eventTypeCode: 'AWS_EC2_NETWORK_ISSUE',
      eventTypeCategory: 'issue',
      region: 'us-east-1',
      startTime: '2026-07-04T00:00:00Z',
      statusCode: 'open',
      eventDescription: {
        latestDescription: 'Increased network latency for EC2 instances in us-east-1a',
      },
    },
    {
      arn: 'arn:aws:health:us-west-2::event/AWS_RDS_AZ_DEGRADATION/def456',
      service: 'RDS',
      eventTypeCode: 'AWS_RDS_AZ_DEGRADATION',
      eventTypeCategory: 'issue',
      region: 'us-west-2',
      startTime: '2026-07-03T12:00:00Z',
      endTime: '2026-07-03T18:00:00Z',
      statusCode: 'closed',
      eventDescription: {
        latestDescription: 'Multi-AZ instance failover performance degraded',
      },
    },
  ],
}

const HEALTH_ERROR_OUTPUT = JSON.stringify({
  message: 'User is not subscribed to AWS Health. Please upgrade to Business or Enterprise support plan.',
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creds(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock child_process.execFile (callback style — agent.ts wraps it with
// util.promisify). Security note: agent.ts uses execFile with an argument
// array (not execSync with a shell string) specifically so that tool-call
// parameters — which are LLM-reachable, unlike bootstrap.ts's API-response
// -only interpolated values — can never be interpreted as shell
// metacharacters. These tests assert against the real argv array passed to
// execFile, not a joined command string, to keep that guarantee honest.
// ---------------------------------------------------------------------------

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('child_process', () => ({ execFile }))

function mockStdout(json: unknown): void {
  execFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null, { stdout: JSON.stringify(json), stderr: '' })
    },
  )
}

function mockRawStdout(raw: string): void {
  execFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null, { stdout: raw, stderr: '' })
    },
  )
}

function mockError(message: string): void {
  execFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error(message), { stdout: '', stderr: message })
    },
  )
}

describe('AwsCloudwatchAgent — tool tests (mocked execFile, argv array)', () => {
  beforeEach(() => { execFile.mockReset() })

  // -- get_cloud_metrics ----------------------------------------------------
  describe('get_cloud_metrics', () => {
    it('parses CloudWatch get-metric-statistics JSON into {t,v} points', async () => {
      mockStdout(GET_METRICS_OUTPUT)

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: 'i-abc123', metric: 'CPUUtilization', window: '1h' },
        creds(),
      ) as { points: Array<{ t: number; v: number }> }

      expect(result.points).toHaveLength(3)
      expect(result.points[0]!.v).toBe(2.34)
      expect(result.points[1]!.v).toBe(5.12)
      expect(result.points[2]!.v).toBe(1.89)
      // Verify sorted by time
      const ts = result.points.map(p => p.t)
      expect([...ts].sort((a, b) => a - b)).toEqual(ts)
    })

    it('constructs correct AWS CLI argv array (not a shell string)', async () => {
      mockStdout({ Datapoints: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: 'i-xyz789', metric: 'NetworkIn', window: '30m' },
        creds({ region: 'us-west-2' }),
      )

      expect(execFile.mock.calls[0]![0]).toBe('aws')
      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('cloudwatch')
      expect(args).toContain('get-metric-statistics')
      expect(args).toContain('--namespace')
      expect(args).toContain('AWS/EC2')
      expect(args).toContain('--metric-name')
      expect(args).toContain('NetworkIn')
      expect(args).toContain('Name=InstanceId,Value=i-xyz789')
      expect(args).toContain('--period')
      expect(args).toContain('300')
      expect(args).toContain('--statistics')
      expect(args).toContain('Average')
      expect(args).toContain('--output')
      expect(args).toContain('json')

      // Verify env has AWS_DEFAULT_REGION=us-west-2
      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_DEFAULT_REGION']).toBe('us-west-2')
    })

    it('a resource value containing shell metacharacters is never shell-interpreted', async () => {
      // Regression guard for the execSync -> execFile fix. If this were ever
      // interpolated into a shell string again, a value like this would
      // attempt command substitution. With execFile + argv array, it must
      // reach the mock as one inert array element and never execute anything.
      mockStdout({ Datapoints: [] })
      const injected = 'i-abc; $(touch /tmp/pwned); `id`'

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute({ resource: injected, metric: 'CPUUtilization', window: '5m' }, creds())

      expect(execFile.mock.calls[0]![0]).toBe('aws')
      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain(`Name=InstanceId,Value=${injected}`)
    })

    it('returns empty points when execFile errors', async () => {
      mockError('command not found')

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: 'i-bad', metric: 'CPUUtilization', window: '5m' },
        creds(),
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })

    it('returns empty points when AWS returns invalid JSON', async () => {
      mockRawStdout('not json')

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: 'i-abc', metric: 'CPUUtilization', window: '5m' },
        creds(),
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })

    it('returns empty points when creds are missing (aws CLI will fail)', async () => {
      mockError('Unable to locate credentials')

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: 'i-abc', metric: 'CPUUtilization', window: '5m' },
        {}, // no creds
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })
  })

  // -- get_alarms -----------------------------------------------------------
  describe('get_alarms', () => {
    it('parses describe-alarms MetricAlarms into {id,name,state,reason}', async () => {
      mockStdout(DESCRIBE_ALARMS_OUTPUT)

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: Array<Record<string, string>> }

      expect(result.alarms).toHaveLength(2)
      expect(result.alarms[0]).toEqual({
        id: 'High-CPU-alarm',
        name: 'High-CPU-alarm',
        state: 'ALARM',
        reason: 'Threshold Crossed: 1 datapoint (85.5) was >= 80.0',
      })
      expect(result.alarms[1]).toEqual({
        id: 'Low-Memory-alarm',
        name: 'Low-Memory-alarm',
        state: 'OK',
        reason: 'Threshold Crossed: 1 datapoint (45.2) was not >= 70.0',
      })
    })

    it('appends --alarm-name-prefix when service param provided', async () => {
      mockStdout({ MetricAlarms: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({ service: 'payments' }, creds())

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('--alarm-name-prefix')
      expect(args).toContain('payments')
    })

    it('does NOT append --alarm-name-prefix when no service', async () => {
      mockStdout({ MetricAlarms: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds())

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).not.toContain('--alarm-name-prefix')
    })

    it('returns empty alarms on CLI failure', async () => {
      mockError('AccessDenied')

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: unknown[] }

      expect(result.alarms).toEqual([])
    })
  })

  // -- get_health_events ----------------------------------------------------
  describe('get_health_events', () => {
    it('parses health describe-events into {service,region,status,message}', async () => {
      mockStdout(HEALTH_EVENTS_OUTPUT)

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: Array<Record<string, string>> }

      expect(result.events).toHaveLength(2)
      expect(result.events[0]).toEqual({
        service: 'EC2',
        region: 'us-east-1',
        status: 'open',
        message: 'Increased network latency for EC2 instances in us-east-1a',
      })
      expect(result.events[1]).toEqual({
        service: 'RDS',
        region: 'us-west-2',
        status: 'closed',
        message: 'Multi-AZ instance failover performance degraded',
      })
    })

    it('returns empty events on subscription-not-entitled error (graceful)', async () => {
      mockError(HEALTH_ERROR_OUTPUT)

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: unknown[] }

      expect(result.events).toEqual([])
    })

    it('returns empty events on missing AWS creds', async () => {
      mockError('Unable to locate credentials')

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, {}) as { events: unknown[] }

      expect(result.events).toEqual([])
    })
  })

  // -- auth/env wiring ------------------------------------------------------
  describe('auth wiring', () => {
    it('sets AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from creds', async () => {
      mockStdout({ MetricAlarms: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds({ accessKeyId: 'AKIA_CUSTOM', secretAccessKey: 'super-secret' }))

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_ACCESS_KEY_ID']).toBe('AKIA_CUSTOM')
      expect(callEnv.env!['AWS_SECRET_ACCESS_KEY']).toBe('super-secret')
    })

    it('sets AWS_SESSION_TOKEN when provided', async () => {
      mockStdout({ MetricAlarms: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds({ sessionToken: 'FwoGZX...' }))

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_SESSION_TOKEN']).toBe('FwoGZX...')
    })

    it('sets AWS_ENDPOINT_URL when endpointUrl provided (LocalStack override)', async () => {
      mockStdout({ MetricAlarms: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds({ endpointUrl: 'http://localhost:4566' }))

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_ENDPOINT_URL']).toBe('http://localhost:4566')
    })

    it('omits AWS_ENDPOINT_URL when not provided (real AWS in production)', async () => {
      mockStdout({ MetricAlarms: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds())

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_ENDPOINT_URL']).toBeUndefined()
    })

    it('defaults region to us-east-1 when not provided', async () => {
      mockStdout({ MetricAlarms: [] })

      const agent = new AwsCloudwatchAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, {})

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_DEFAULT_REGION']).toBe('us-east-1')
    })
  })
})
