import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GcpMonitoringAgent } from './agent.js'
import { GcpMonitoringBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

// ---------------------------------------------------------------------------
// Realistic gcloud CLI JSON fixtures
// ---------------------------------------------------------------------------

const METRICS_TIMESERIES_OUTPUT = [
  {
    metric: { type: 'compute.googleapis.com/instance/cpu/utilization', labels: { instance_name: 'web-server-01' } },
    resource: { type: 'gce_instance', labels: { project_id: 'my-project', zone: 'us-central1-a', instance_id: '1234567890' } },
    metricKind: 'GAUGE',
    valueType: 'DOUBLE',
    points: [
      { interval: { startTime: '2026-07-04T10:00:00Z', endTime: '2026-07-04T10:00:00Z' }, value: { doubleValue: 0.42 } },
      { interval: { startTime: '2026-07-04T10:05:00Z', endTime: '2026-07-04T10:05:00Z' }, value: { doubleValue: 0.55 } },
      { interval: { startTime: '2026-07-04T10:10:00Z', endTime: '2026-07-04T10:10:00Z' }, value: { doubleValue: 0.38 } },
    ],
  },
]

const METRICS_INT64_OUTPUT = [
  {
    metric: { type: 'compute.googleapis.com/instance/disk/read_bytes_count', labels: {} },
    resource: { type: 'gce_instance', labels: { project_id: 'my-project', zone: 'us-central1-a', instance_id: '1234567890' } },
    metricKind: 'DELTA',
    valueType: 'INT64',
    points: [
      { interval: { startTime: '2026-07-04T10:00:00Z', endTime: '2026-07-04T10:00:00Z' }, value: { int64Value: '1048576' } },
      { interval: { startTime: '2026-07-04T10:05:00Z', endTime: '2026-07-04T10:05:00Z' }, value: { int64Value: '2097152' } },
    ],
  },
]

const POLICIES_OUTPUT = [
  {
    name: 'projects/my-project/alertPolicies/123456789',
    displayName: 'High CPU Alert',
    enabled: true,
    conditions: [
      {
        name: 'projects/my-project/alertPolicies/123456789/conditions/987654321',
        displayName: 'CPU > 90%',
        conditionThreshold: {
          filter: 'metric.type="compute.googleapis.com/instance/cpu/utilization"',
          comparison: 'COMPARISON_GT',
          thresholdValue: 0.9,
        },
      },
    ],
    notificationChannels: [],
    creationRecord: { mutateTime: '2026-01-01T00:00:00Z' },
    mutationRecord: { mutateTime: '2026-06-01T00:00:00Z' },
  },
  {
    name: 'projects/my-project/alertPolicies/987654321',
    displayName: 'Memory Usage Alert',
    enabled: false,
    conditions: [
      {
        name: 'projects/my-project/alertPolicies/987654321/conditions/123456789',
        displayName: 'Memory > 80%',
        conditionThreshold: {
          filter: 'metric.type="compute.googleapis.com/instance/memory/utilization"',
          comparison: 'COMPARISON_GT',
          thresholdValue: 0.8,
        },
      },
    ],
    notificationChannels: [],
    creationRecord: { mutateTime: '2026-01-02T00:00:00Z' },
    mutationRecord: { mutateTime: '2026-06-02T00:00:00Z' },
  },
]

const INCIDENTS_OUTPUT = [
  {
    name: 'projects/my-project/incidents/inc123',
    policyName: 'projects/my-project/alertPolicies/123456789',
    state: 'open',
    startedAt: '2026-07-04T10:00:00Z',
    summary: 'CPU utilization above 90% threshold for 5 minutes',
    conditionName: 'projects/my-project/alertPolicies/123456789/conditions/987654321',
  },
]

const HEALTH_EVENTS_OUTPUT = {
  events: [
    {
      name: 'projects/my-project/locations/global/events/evt-001',
      title: 'Compute Engine incident in us-central1',
      description: 'We are experiencing an issue with Google Compute Engine affecting instances in us-central1.',
      category: 'INCIDENT',
      state: 'ACTIVE',
      detailedState: 'CONFIRMED',
      affectedProducts: ['Google Compute Engine'],
      affectedLocations: ['us-central1'],
      startTime: '2026-07-04T08:00:00Z',
      updateTime: '2026-07-04T09:30:00Z',
    },
    {
      name: 'projects/my-project/locations/global/events/evt-002',
      title: 'Cloud SQL maintenance',
      description: 'Scheduled maintenance for Cloud SQL instances in europe-west1.',
      category: 'MAINTENANCE',
      state: 'SCHEDULED',
      affectedProducts: ['Google Cloud SQL'],
      affectedLocations: ['europe-west1'],
      startTime: '2026-07-05T02:00:00Z',
      updateTime: '2026-07-04T12:00:00Z',
    },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creds(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    google_application_credentials: '/path/to/service-account-key.json',
    project_id: 'my-project',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock child_process.execFile (callback style — agent.ts wraps it with
// util.promisify). Security note: agent.ts uses execFile with an argument
// array (not execSync with a shell string) specifically so that tool-call
// parameters — which are LLM-reachable — can never be interpreted as shell
// metacharacters. These tests assert against the real argv array passed to
// execFile, not a joined command string, to keep that guarantee honest.
//
// get_health_events also uses native fetch() for the Personalized Service
// Health API call (not curl). We mock globalThis.fetch for those tests.
// ---------------------------------------------------------------------------

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('child_process', () => ({ execFile }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

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

// -- Once variants (for tests where execFile is called multiple times with
//    different outcomes, e.g. get_alarms: policies call → incidents call) ---
function mockStdoutOnce(json: unknown): void {
  execFile.mockImplementationOnce(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null, { stdout: JSON.stringify(json), stderr: '' })
    },
  )
}

function mockErrorOnce(message: string): void {
  execFile.mockImplementationOnce(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error(message), { stdout: '', stderr: message })
    },
  )
}

describe('GcpMonitoringAgent — tool tests (mocked execFile, argv array)', () => {
  beforeEach(() => {
    execFile.mockReset()
    mockFetch.mockReset()
  })

  // -- get_cloud_metrics ----------------------------------------------------
  describe('get_cloud_metrics', () => {
    it('parses gcloud monitoring time-series list JSON into {t,v} points', async () => {
      mockStdout(METRICS_TIMESERIES_OUTPUT)

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: '1234567890', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '1h' },
        creds(),
      ) as { points: Array<{ t: number; v: number }> }

      expect(result.points).toHaveLength(3)
      expect(result.points[0]!.v).toBe(0.42)
      expect(result.points[1]!.v).toBe(0.55)
      expect(result.points[2]!.v).toBe(0.38)
      // Verify sorted by time ascending
      const ts = result.points.map(p => p.t)
      expect([...ts].sort((a, b) => a - b)).toEqual(ts)
    })

    it('constructs correct gcloud CLI argv array (not a shell string)', async () => {
      mockStdout([])

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: 'i-xyz789', metric: 'compute.googleapis.com/instance/network/received_bytes_count', window: '30m' },
        creds({ project_id: 'custom-project' }),
      )

      expect(execFile.mock.calls[0]![0]).toBe('gcloud')
      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('monitoring')
      expect(args).toContain('time-series')
      expect(args).toContain('list')
      expect(args).toContain('--filter')
      expect(args).toContain('--interval-start-time')
      expect(args).toContain('--interval-end-time')
      expect(args).toContain('--project')
      expect(args).toContain('custom-project')
      expect(args).toContain('--format=json')
      // Filter value is one complete argv element (not shell-split)
      const filterIdx = args.indexOf('--filter')
      expect(args[filterIdx + 1]).toContain('metric.type="compute.googleapis.com/instance/network/received_bytes_count"')
      expect(args[filterIdx + 1]).toContain('resource.labels.instance_id="i-xyz789"')

      // Verify env wiring: GOOGLE_APPLICATION_CREDENTIALS set
      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/path/to/service-account-key.json')
      expect(callEnv.env!['CLOUDSDK_CORE_PROJECT']).toBe('custom-project')
    })

    it('handles int64Value point type', async () => {
      mockStdout(METRICS_INT64_OUTPUT)

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: '1234567890', metric: 'compute.googleapis.com/instance/disk/read_bytes_count', window: '10m' },
        creds(),
      ) as { points: Array<{ t: number; v: number }> }

      expect(result.points).toHaveLength(2)
      expect(result.points[0]!.v).toBe(1048576)
      expect(result.points[1]!.v).toBe(2097152)
    })

    it('flattens points across multiple time series', async () => {
      const multiTs = [
        {
          metric: { type: 'compute.googleapis.com/instance/cpu/utilization' },
          resource: { type: 'gce_instance', labels: { instance_id: 'a' } },
          metricKind: 'GAUGE', valueType: 'DOUBLE',
          points: [{ interval: { endTime: '2026-07-04T10:00:00Z' }, value: { doubleValue: 0.1 } }],
        },
        {
          metric: { type: 'compute.googleapis.com/instance/cpu/utilization' },
          resource: { type: 'gce_instance', labels: { instance_id: 'b' } },
          metricKind: 'GAUGE', valueType: 'DOUBLE',
          points: [{ interval: { endTime: '2026-07-04T10:00:00Z' }, value: { doubleValue: 0.9 } }],
        },
      ]
      mockStdout(multiTs)

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: '*', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        creds(),
      ) as { points: Array<{ t: number; v: number }> }

      expect(result.points).toHaveLength(2)
    })

    it('throws when execFile errors (real CLI failure, not an empty result)', async () => {
      mockError('command not found')

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await expect(tool.execute(
        { resource: 'i-bad', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        creds(),
      )).rejects.toThrow('command not found')
    })

    it('throws when gcloud returns invalid JSON (real parse failure, not an empty result)', async () => {
      mockRawStdout('not json')

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await expect(tool.execute(
        { resource: 'i-abc', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        creds(),
      )).rejects.toThrow()
    })

    it('returns empty points when result is not an array', async () => {
      mockStdout({ error: 'something went wrong' })

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: 'i-abc', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        creds(),
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })

    it('throws when creds are missing (gcloud CLI will fail — real failure, not an empty result)', async () => {
      mockError('Unable to locate credentials')

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await expect(tool.execute(
        { resource: 'i-abc', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        {}, // no creds
      )).rejects.toThrow('Unable to locate credentials')
    })

    it('a resource value containing shell metacharacters is never shell-interpreted', async () => {
      // Regression guard for the execSync -> execFile fix. If this were ever
      // interpolated into a shell string again, a value like this would
      // attempt command substitution. With execFile + argv array, the filter
      // string containing the injected resource must reach the mock as one
      // inert array element and never execute anything.
      mockStdout([])
      const injected = 'i-abc; $(touch /tmp/pwned); `id`'

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: injected, metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        creds(),
      )

      expect(execFile.mock.calls[0]![0]).toBe('gcloud')
      const args = execFile.mock.calls[0]![1] as string[]
      const filterIdx = args.indexOf('--filter')
      // The filter value contains the injected metacharacters as literal text
      expect(args[filterIdx + 1]).toContain(`resource.labels.instance_id="${injected}"`)
    })
  })

  // -- get_alarms -----------------------------------------------------------
  describe('get_alarms', () => {
    it('parses policies + incidents into {id,name,state,reason}', async () => {
      // First call: policies list, second call: incidents list
      mockStdoutOnce(POLICIES_OUTPUT)
      mockStdoutOnce(INCIDENTS_OUTPUT)

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: Array<Record<string, string>> }

      expect(result.alarms).toHaveLength(2)
      // High CPU Alert has an open incident → ALARM
      expect(result.alarms[0]).toEqual({
        id: 'projects/my-project/alertPolicies/123456789',
        name: 'High CPU Alert',
        state: 'ALARM',
        reason: 'CPU utilization above 90% threshold for 5 minutes',
      })
      // Memory Usage Alert is disabled → DISABLED
      expect(result.alarms[1]).toEqual({
        id: 'projects/my-project/alertPolicies/987654321',
        name: 'Memory Usage Alert',
        state: 'DISABLED',
        reason: 'Policy disabled',
      })
    })

    it('returns OK state for enabled policies with no open incidents', async () => {
      mockStdoutOnce(POLICIES_OUTPUT)
      mockStdoutOnce([]) // no incidents

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: Array<Record<string, string>> }

      expect(result.alarms[0]!.state).toBe('OK')
      expect(result.alarms[0]!.reason).toBe('CPU > 90%')
      expect(result.alarms[1]!.state).toBe('DISABLED')
    })

    it('falls back to policy-only info when incidents alpha command fails', async () => {
      mockStdoutOnce(POLICIES_OUTPUT)
      mockErrorOnce('alpha command not available')

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: Array<Record<string, string>> }

      // Should still get policies, states fall back to OK/DISABLED based on enabled
      expect(result.alarms).toHaveLength(2)
      expect(result.alarms[0]!.state).toBe('OK')
      expect(result.alarms[1]!.state).toBe('DISABLED')
    })

    it('appends --filter by displayName when service param provided', async () => {
      mockStdoutOnce([])
      mockStdoutOnce([])

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({ service: 'payments' }, creds())

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('--filter')
      expect(args).toContain('displayName~payments')
    })

    it('does NOT append --filter when no service param', async () => {
      mockStdoutOnce([])
      mockStdoutOnce([])

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, creds())

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).not.toContain('--filter')
    })

    it('throws on policies CLI failure (the primary data — real failure, not an empty result)', async () => {
      mockErrorOnce('PermissionDenied')

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await expect(tool.execute({}, creds())).rejects.toThrow('PermissionDenied')
    })

    it('returns empty alarms when policies result is not an array', async () => {
      mockStdoutOnce({ code: 403, message: 'Forbidden' })

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: unknown[] }

      expect(result.alarms).toEqual([])
    })
  })

  // -- get_health_events ----------------------------------------------------
  describe('get_health_events', () => {
    it('parses Service Health API events into {service,region,status,message}', async () => {
      // First: gcloud auth print-access-token via execFile, then: fetch to API
      mockRawStdout('ya29.fake-access-token-abc123')
      mockFetch.mockResolvedValue({ ok: true, json: async () => HEALTH_EVENTS_OUTPUT })

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: Array<Record<string, string>> }

      expect(result.events).toHaveLength(2)
      expect(result.events[0]).toEqual({
        service: 'Google Compute Engine',
        region: 'us-central1',
        status: 'ACTIVE',
        message: 'We are experiencing an issue with Google Compute Engine affecting instances in us-central1.',
      })
      expect(result.events[1]).toEqual({
        service: 'Google Cloud SQL',
        region: 'europe-west1',
        status: 'SCHEDULED',
        message: 'Scheduled maintenance for Cloud SQL instances in europe-west1.',
      })
    })

    it('fetches Service Health API with correct URL and auth header', async () => {
      mockRawStdout('ya29.fake-token-xyz')
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ events: [] }) })

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await tool.execute({}, creds({ project_id: 'specific-project' }))

      // Verify gcloud auth was called correctly
      expect(execFile.mock.calls[0]![0]).toBe('gcloud')
      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('auth')
      expect(args).toContain('print-access-token')

      // Verify fetch was called with the correct URL and auth header
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockFetch.mock.calls[0] as [string, { headers?: Record<string, string> }]
      expect(url).toContain('servicehealth.googleapis.com/v1/projects/specific-project/locations/global/events')
      expect(init.headers!['Authorization']).toBe('Bearer ya29.fake-token-xyz')
    })

    it('throws when access token command fails (real CLI failure, not an empty result)', async () => {
      mockError('gcloud not authenticated')

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await expect(tool.execute({}, creds())).rejects.toThrow('gcloud not authenticated')
      // fetch should never have been called (execFile threw before fetch)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('throws when Service Health API call fails (real failure, not an empty result)', async () => {
      mockRawStdout('ya29.fake-token')
      mockFetch.mockResolvedValue({ ok: false, status: 500 })

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await expect(tool.execute({}, creds())).rejects.toThrow('GCP Monitoring get_health_events failed')
    })

    it('throws when no project is configured (real usage error, not an empty result)', async () => {
      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await expect(tool.execute({}, {})).rejects.toThrow('no project configured')
      // Neither execFile nor fetch should have been called (no project → early throw)
      expect(execFile).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('throws on invalid API JSON response (real parse failure, not an empty result)', async () => {
      mockRawStdout('ya29.fake-token')
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => { throw new Error('Unexpected token in JSON') },
      })

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await expect(tool.execute({}, creds())).rejects.toThrow('Unexpected token in JSON')
    })

    it('uses GOOGLE_APPLICATION_CREDENTIALS from creds for auth token call', async () => {
      mockRawStdout('ya29.fake-token')
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ events: [] }) })

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await tool.execute({}, creds({ google_application_credentials: '/custom/key.json' }))

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/custom/key.json')
    })
  })

  // -- auth/env wiring ------------------------------------------------------
  describe('auth wiring', () => {
    it('sets GOOGLE_APPLICATION_CREDENTIALS from creds', async () => {
      mockStdout([])

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: 'i-abc', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        creds({ google_application_credentials: '/tmp/my-key.json' }),
      )

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/tmp/my-key.json')
    })

    it('sets CLOUDSDK_CORE_PROJECT from creds.project_id', async () => {
      mockStdout([])

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: 'i-abc', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        creds({ project_id: 'production-123' }),
      )

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['CLOUDSDK_CORE_PROJECT']).toBe('production-123')
    })

    it('does not set project flag when no project_id in creds', async () => {
      mockStdout([])

      const agent = new GcpMonitoringAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: 'i-abc', metric: 'compute.googleapis.com/instance/cpu/utilization', window: '5m' },
        { google_application_credentials: '/tmp/key.json' },
      )

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).not.toContain('--project')
    })
  })
})

// ---------------------------------------------------------------------------
// Bootstrap tests — real gcloud CLI calls (no fake placeholder entities)
// ---------------------------------------------------------------------------
describe('GcpMonitoringBootstrap — bootstrap tests (mocked execFile + fetch)', () => {
  beforeEach(() => {
    execFile.mockReset()
    mockFetch.mockReset()
  })

  it('upserts Alert entities from real alert policies list + service health events', async () => {
    // 1st execFile: monitoring policies list → 2 policies
    mockStdoutOnce(POLICIES_OUTPUT)
    // 2nd execFile: gcloud auth print-access-token
    execFile.mockImplementationOnce(
      (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, { stdout: 'fake-token\n', stderr: '' })
      },
    )
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => HEALTH_EVENTS_OUTPUT,
    })

    const kg = new FakeKnowledgeGraph()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      { project_id: 'my-project' },
    )

    expect(result.entitiesUpserted).toBe(2 + HEALTH_EVENTS_OUTPUT.events.length)
    expect(result.episodeHints[0]).toContain('2 alert policies discovered')
    expect(result.episodeHints[1]).toContain(`${HEALTH_EVENTS_OUTPUT.events.length} service health events discovered`)
  })

  it('returns zero entities gracefully when policies list fails', async () => {
    mockErrorOnce('gcloud: command not found')

    const kg = new FakeKnowledgeGraph()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      {},
    )

    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints[0]).toContain('no data')
  })

  it('skips service health events when no project_id provided', async () => {
    mockStdout(POLICIES_OUTPUT)

    const kg = new FakeKnowledgeGraph()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      {},
    )

    expect(result.entitiesUpserted).toBe(2)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.episodeHints).toContain('No project_id provided — service health events not queried.')
  })

  it('marks disabled policies with low severity and disabled status', async () => {
    mockStdoutOnce(POLICIES_OUTPUT)
    execFile.mockImplementationOnce(
      (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(new Error('no token'), { stdout: '', stderr: '' })
      },
    )

    const kg = new FakeKnowledgeGraph()
    await new GcpMonitoringBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      { project_id: 'my-project' },
    )

    const disabled = kg.entities.find(e => e.name === 'Memory Usage Alert')
    expect(disabled?.metadata?.['status']).toBe('disabled')
    expect(disabled?.metadata?.['severity']).toBe('low')
  })

  it('handles both policies list and service health failing', async () => {
    mockError('command not found')

    const kg = new FakeKnowledgeGraph()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-conn',
      { project_id: 'my-project' },
    )

    expect(result.entitiesUpserted).toBe(0)
  })
})
