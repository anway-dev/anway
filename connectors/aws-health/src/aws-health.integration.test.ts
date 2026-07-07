import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AwsHealthAgent } from './agent.js'
import { AwsHealthBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

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
      arn: 'arn:aws:health:us-west-2::event/RDS/AWS_RDS_AZ_DEGRADATION/def456',
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

const HEALTH_EMPTY_OUTPUT = { events: [] }

// --query "MetricAlarms[*]" extracts a bare array
const CLOUDWATCH_ALARMS_FOR_BOOTSTRAP = [
  {
    AlarmName: 'prod-payments-high-latency',
    StateValue: 'ALARM',
    MetricName: 'Latency',
    Namespace: 'AWS/ELB',
    AlarmDescription: 'ALB p99 latency > 2s',
  },
]

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
// Tests
// ---------------------------------------------------------------------------

// agent.ts uses execFile (argv array — safe against shell injection from
// LLM-reachable tool-call params); bootstrap.ts still uses execSync (safe
// there since it only ever runs two hardcoded command strings with no
// interpolated params). Mock both from the same child_process factory.
const { execSync, execFile } = vi.hoisted(() => ({ execSync: vi.fn(), execFile: vi.fn() }))
vi.mock('child_process', () => ({ execSync, execFile }))

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void

function mockExecFileStdout(json: unknown): void {
  execFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null, { stdout: JSON.stringify(json), stderr: '' })
    },
  )
}

function mockExecFileRawStdout(raw: string): void {
  execFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null, { stdout: raw, stderr: '' })
    },
  )
}

function mockExecFileError(message: string): void {
  execFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error(message), { stdout: '', stderr: message })
    },
  )
}

describe('AwsHealthAgent — tool tests (mocked execFile, argv array)', () => {
  beforeEach(() => { execFile.mockReset() })

  // -- get_cloud_metrics ----------------------------------------------------
  describe('get_cloud_metrics', () => {
    it('parses CloudWatch get-metric-statistics JSON into {t,v} points', async () => {
      mockExecFileStdout(GET_METRICS_OUTPUT)

      const agent = new AwsHealthAgent()
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
      mockExecFileStdout({ Datapoints: [] })

      const agent = new AwsHealthAgent()
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
      mockExecFileStdout({ Datapoints: [] })
      const injected = 'i-abc; $(touch /tmp/pwned); `id`'

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute({ resource: injected, metric: 'CPUUtilization', window: '5m' }, creds())

      expect(execFile.mock.calls[0]![0]).toBe('aws')
      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain(`Name=InstanceId,Value=${injected}`)
    })

    it('throws when execFile errors (real CLI failure, not an empty result)', async () => {
      mockExecFileError('command not found')

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await expect(tool.execute(
        { resource: 'i-bad', metric: 'CPUUtilization', window: '5m' },
        creds(),
      )).rejects.toThrow('command not found')
    })

    it('throws when AWS returns invalid JSON (real parse failure, not an empty result)', async () => {
      mockExecFileRawStdout('not json')

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await expect(tool.execute(
        { resource: 'i-abc', metric: 'CPUUtilization', window: '5m' },
        creds(),
      )).rejects.toThrow()
    })

    it('throws when creds are missing (aws CLI will fail — real failure, not an empty result)', async () => {
      mockExecFileError('Unable to locate credentials')

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await expect(tool.execute(
        { resource: 'i-abc', metric: 'CPUUtilization', window: '5m' },
        {}, // no creds
      )).rejects.toThrow('Unable to locate credentials')
    })
  })

  // -- get_alarms -----------------------------------------------------------
  describe('get_alarms', () => {
    it('parses describe-alarms MetricAlarms into {id,name,state,reason}', async () => {
      mockExecFileStdout(DESCRIBE_ALARMS_OUTPUT)

      const agent = new AwsHealthAgent()
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
      mockExecFileStdout({ MetricAlarms: [] })

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({ service: 'payments' }, creds())

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('--alarm-name-prefix')
      expect(args).toContain('payments')
    })

    it('does NOT append --alarm-name-prefix when no service', async () => {
      mockExecFileStdout({ MetricAlarms: [] })

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds())

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).not.toContain('--alarm-name-prefix')
    })

    it('throws on CLI failure (real failure, not an empty result)', async () => {
      mockExecFileError('AccessDenied')

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await expect(tool.execute({}, creds())).rejects.toThrow('AccessDenied')
    })
  })

  // -- get_health_events ----------------------------------------------------
  describe('get_health_events', () => {
    it('parses health describe-events into {service,region,status,message}', async () => {
      mockExecFileStdout(HEALTH_EVENTS_OUTPUT)

      const agent = new AwsHealthAgent()
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

    it('throws on subscription-not-entitled error (real failure, documented honestly, not silently empty)', async () => {
      mockExecFileError('User is not subscribed to AWS Health')

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await expect(tool.execute({}, creds())).rejects.toThrow('User is not subscribed to AWS Health')
    })

    it('returns empty events when health returns empty events array', async () => {
      mockExecFileStdout(HEALTH_EMPTY_OUTPUT)

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: unknown[] }

      expect(result.events).toEqual([])
    })

    it('throws on missing AWS creds (real failure, not an empty result)', async () => {
      mockExecFileError('Unable to locate credentials')

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await expect(tool.execute({}, {})).rejects.toThrow('Unable to locate credentials')
    })
  })

  // -- auth/env wiring ------------------------------------------------------
  describe('auth wiring', () => {
    it('sets AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from creds', async () => {
      mockExecFileStdout({ MetricAlarms: [] })

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds({ accessKeyId: 'AKIA_CUSTOM', secretAccessKey: 'super-secret' }))

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_ACCESS_KEY_ID']).toBe('AKIA_CUSTOM')
      expect(callEnv.env!['AWS_SECRET_ACCESS_KEY']).toBe('super-secret')
    })

    it('sets AWS_SESSION_TOKEN when provided', async () => {
      mockExecFileStdout({ MetricAlarms: [] })

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds({ sessionToken: 'FwoGZX...' }))

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_SESSION_TOKEN']).toBe('FwoGZX...')
    })

    it('sets AWS_ENDPOINT_URL when endpointUrl provided (LocalStack override)', async () => {
      mockExecFileStdout({ MetricAlarms: [] })

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds({ endpointUrl: 'http://localhost:4566' }))

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_ENDPOINT_URL']).toBe('http://localhost:4566')
    })

    it('omits AWS_ENDPOINT_URL when not provided (real AWS in production)', async () => {
      mockExecFileStdout({ MetricAlarms: [] })

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds())

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_ENDPOINT_URL']).toBeUndefined()
    })

    it('defaults region to us-east-1 when not provided', async () => {
      mockExecFileStdout({ MetricAlarms: [] })

      const agent = new AwsHealthAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, {})

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AWS_DEFAULT_REGION']).toBe('us-east-1')
    })
  })
})

// -- Bootstrap tests --------------------------------------------------------
describe('AwsHealthBootstrap — bootstrap tests (mocked execSync)', () => {
  beforeEach(() => { execSync.mockReset() })

  it('upserts Alert entities from real health describe-events + CloudWatch alarms', async () => {
    // First call: health describe-events → 2 events
    // Second call: cloudwatch describe-alarms → 1 alarm
    execSync
      .mockReturnValueOnce(Buffer.from(JSON.stringify(HEALTH_EVENTS_OUTPUT)))
      .mockReturnValueOnce(Buffer.from(JSON.stringify(CLOUDWATCH_ALARMS_FOR_BOOTSTRAP)))

    const kg = new FakeKnowledgeGraph()
    const result = await new AwsHealthBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      { accessKeyId: 'AKIA_TEST', secretAccessKey: 'test-secret', region: 'us-east-1' },
    )

    expect(result.entitiesUpserted).toBe(3) // 2 health events + 1 alarm
    expect(result.episodeHints).toHaveLength(2)
    expect(result.episodeHints[0]).toContain('2 events discovered')
    expect(result.episodeHints[1]).toContain('1 CloudWatch alarms in ALARM state')
  })

  it('returns zero entities gracefully when health describe-events fails (no support plan)', async () => {
    execSync
      .mockImplementationOnce(() => { throw new Error('SubscriptionRequiredException') })
      .mockReturnValueOnce(Buffer.from(JSON.stringify([])))

    const kg = new FakeKnowledgeGraph()
    const result = await new AwsHealthBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      { accessKeyId: 'AKIA_TEST', secretAccessKey: 'test-secret', region: 'us-east-1' },
    )

    // Health call failed → 0 health entities. Alarms call returned empty → 0 alarm entities.
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints[0]).toContain('no data')
  })

  it('accepts snake_case cred keys (access_key_id, secret_access_key, session_token)', async () => {
    execSync
      .mockReturnValueOnce(Buffer.from(JSON.stringify(HEALTH_EVENTS_OUTPUT)))
      .mockReturnValueOnce(Buffer.from(JSON.stringify([])))

    const kg = new FakeKnowledgeGraph()
    const result = await new AwsHealthBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      { access_key_id: 'AKIA_SNAKE', secret_access_key: 'snake-secret', session_token: 'snake-token', region: 'eu-west-1' },
    )

    expect(result.entitiesUpserted).toBe(2)
    // Verify env got the snake_case creds
    const callEnv = execSync.mock.calls[0]![1] as { env?: Record<string, string> }
    expect(callEnv.env!['AWS_ACCESS_KEY_ID']).toBe('AKIA_SNAKE')
    expect(callEnv.env!['AWS_SECRET_ACCESS_KEY']).toBe('snake-secret')
    expect(callEnv.env!['AWS_SESSION_TOKEN']).toBe('snake-token')
    expect(callEnv.env!['AWS_DEFAULT_REGION']).toBe('eu-west-1')
  })

  it('handles both describe-events and describe-alarms failing', async () => {
    execSync.mockImplementation(() => { throw new Error('command not found') })

    const kg = new FakeKnowledgeGraph()
    const result = await new AwsHealthBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      {},
    )

    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints[0]).toContain('no data')
  })

  it('skips health events without arn field', async () => {
    execSync
      .mockReturnValueOnce(Buffer.from(JSON.stringify({
        events: [
          { service: 'EC2', region: 'us-east-1', statusCode: 'open' }, // no arn → skip
          {
            arn: 'arn:aws:health:us-east-1::event/EC2/TEST/valid1',
            service: 'EC2',
            eventTypeCode: 'AWS_EC2_TEST',
            region: 'us-east-1',
            statusCode: 'open',
            eventDescription: { latestDescription: 'Valid event' },
          },
        ],
      })))
      .mockReturnValueOnce(Buffer.from(JSON.stringify([])))

    const kg = new FakeKnowledgeGraph()
    const result = await new AwsHealthBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      { accessKeyId: 'AKIA_TEST', secretAccessKey: 'test-secret' },
    )

    // Only the event with arn is upserted
    expect(result.entitiesUpserted).toBe(1)
  })
})
