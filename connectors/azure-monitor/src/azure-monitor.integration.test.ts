import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AzureMonitorAgent } from './agent.js'

// ---------------------------------------------------------------------------
// Realistic Azure CLI JSON fixtures
// ---------------------------------------------------------------------------

const METRICS_OUTPUT = {
  value: [
    {
      timeseries: [
        {
          data: [
            { timeStamp: '2026-07-04T10:00:00Z', average: 2.34 },
            { timeStamp: '2026-07-04T10:01:00Z', average: 5.12 },
            { timeStamp: '2026-07-04T10:02:00Z', average: 1.89 },
          ],
        },
      ],
    },
  ],
}

const METRICS_EMPTY_OUTPUT = { value: [] }

const METRICS_MULTI_TIMESERIES_OUTPUT = {
  value: [
    {
      timeseries: [
        {
          data: [
            { timeStamp: '2026-07-04T10:00:00Z', average: 2.34 },
            { timeStamp: '2026-07-04T10:01:00Z', average: 5.12 },
          ],
        },
        {
          data: [
            { timeStamp: '2026-07-04T10:00:00Z', average: 1.10 },
            { timeStamp: '2026-07-04T10:01:00Z', average: 2.20 },
          ],
        },
      ],
    },
  ],
}

const ALERTS_OUTPUT = [
  {
    id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-rg/providers/Microsoft.Insights/metricAlerts/High-CPU-alert',
    name: 'High-CPU-alert',
    description: 'Alert when CPU exceeds 80% on production VMs',
    enabled: true,
    severity: 'Sev2',
    condition: {
      allOf: [
        {
          metricName: 'Percentage CPU',
          operator: 'GreaterThan',
          threshold: 80,
        },
      ],
    },
    scopes: [
      '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/vm-prod-1',
    ],
  },
  {
    id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-rg/providers/Microsoft.Insights/metricAlerts/Memory-low',
    name: 'Memory-low',
    description: 'Alert when available memory drops below 1GB',
    enabled: false,
    severity: 'Sev1',
    condition: {
      allOf: [
        {
          metricName: 'Available Memory Bytes',
          operator: 'LessThan',
          threshold: 1073741824,
        },
      ],
    },
    scopes: [
      '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/vm-prod-2',
    ],
  },
]

const ALERTS_EMPTY_OUTPUT: unknown[] = []

const HEALTH_EVENTS_OUTPUT = {
  value: [
    {
      name: 'event-001',
      properties: {
        title: 'Network connectivity issues in East US',
        service: 'Virtual Machines',
        region: 'East US',
        status: 'Active',
        eventType: 'ServiceIssue',
        eventSource: 'ServiceHealth',
        impactStartTime: '2026-07-04T10:00:00Z',
        impactDescription:
          'Starting at 10:00 UTC, you may experience network connectivity issues when accessing Virtual Machines in East US.',
      },
    },
    {
      name: 'event-002',
      properties: {
        title: 'Advisory: SQL Database maintenance',
        service: 'SQL Database',
        region: 'West Europe',
        status: 'Resolved',
        eventType: 'PlannedMaintenance',
        eventSource: 'ServiceHealth',
        impactStartTime: '2026-07-03T12:00:00Z',
        impactEndTime: '2026-07-03T18:00:00Z',
        impactDescription:
          'Scheduled maintenance for SQL Database in West Europe. Minor latency impact expected.',
      },
    },
  ],
}

const HEALTH_EMPTY_OUTPUT = { value: [] }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creds(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    clientId: '00000000-0000-0000-0000-000000000000',
    clientSecret: 'test-secret',
    tenantId: '00000000-0000-0000-0000-000000000000',
    subscriptionId: '00000000-0000-0000-0000-000000000000',
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

describe('AzureMonitorAgent — tool tests (mocked execFile, argv array)', () => {
  beforeEach(() => { execFile.mockReset() })

  // -- get_cloud_metrics ------------------------------------------------------
  describe('get_cloud_metrics', () => {
    it('parses az monitor metrics list JSON into {t,v} points', async () => {
      mockStdout(METRICS_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        {
          resource: '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1',
          metric: 'Percentage CPU',
          window: '1h',
        },
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

    it('handles multi-timeseries output by flattening all data points', async () => {
      mockStdout(METRICS_MULTI_TIMESERIES_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        {
          resource: '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1',
          metric: 'Percentage CPU',
          window: '1h',
        },
        creds(),
      ) as { points: Array<{ t: number; v: number }> }

      // 2 timeseries × 2 data points each = 4 points
      expect(result.points).toHaveLength(4)
      // Points from both timeseries should be present
      expect(result.points.map(p => p.v)).toContain(2.34)
      expect(result.points.map(p => p.v)).toContain(1.10)
    })

    it('returns empty points for empty value array', async () => {
      mockStdout(METRICS_EMPTY_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: '5m' },
        creds(),
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })

    it('constructs correct az CLI argv array (not a shell string)', async () => {
      mockStdout({ value: [] })

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        {
          resource: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1',
          metric: 'Network In',
          window: '30m',
        },
        creds(),
      )

      expect(execFile.mock.calls[0]![0]).toBe('az')
      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('monitor')
      expect(args).toContain('metrics')
      expect(args).toContain('list')
      expect(args).toContain('--resource')
      expect(args).toContain('--metric')
      expect(args).toContain('Network In')
      expect(args).toContain('--start-time')
      expect(args).toContain('--end-time')
      expect(args).toContain('--interval')
      expect(args).toContain('PT5M')
      expect(args).toContain('--output')
      expect(args).toContain('json')

      // Verify env has Azure SP creds
      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AZURE_CLIENT_ID']).toBe('00000000-0000-0000-0000-000000000000')
      expect(callEnv.env!['AZURE_CLIENT_SECRET']).toBe('test-secret')
      expect(callEnv.env!['AZURE_TENANT_ID']).toBe('00000000-0000-0000-0000-000000000000')
    })

    it('uses PT1M interval for short windows (≤5m)', async () => {
      mockStdout({ value: [] })

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: '5m' },
        creds(),
      )

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('--interval')
      expect(args).toContain('PT1M')
    })

    it('uses PT15M interval for 6h window', async () => {
      mockStdout({ value: [] })

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: '6h' },
        creds(),
      )

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('--interval')
      expect(args).toContain('PT15M')
    })

    it('uses PT1H interval for windows >24h', async () => {
      mockStdout({ value: [] })

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: '7d' },
        creds(),
      )

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('--interval')
      expect(args).toContain('PT1H')
    })

    it('defaults to 1h window on unparseable window string', async () => {
      mockStdout({ value: [] })

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: 'garbage' },
        creds(),
      )

      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('--interval')
      expect(args).toContain('PT5M') // 1h default → ≤1h → PT5M
    })

    it('returns empty points when execFile errors', async () => {
      mockError('command not found')

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: '5m' },
        creds(),
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })

    it('returns empty points when az CLI returns invalid JSON', async () => {
      mockRawStdout('not json')

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: '5m' },
        creds(),
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })

    it('returns empty points when creds are missing (az CLI auth fails)', async () => {
      mockError('Please run az login to setup account')

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      const result = await tool.execute(
        { resource: '/sub/res/rg/vm', metric: 'CPU', window: '5m' },
        {}, // no creds
      ) as { points: unknown[] }

      expect(result.points).toEqual([])
    })

    it('a resource value containing shell metacharacters is never shell-interpreted', async () => {
      // Regression guard for the execSync -> execFile fix. If this were ever
      // interpolated into a shell string again, a value like this would
      // attempt command substitution. With execFile + argv array, it must
      // reach the mock as one inert array element and never execute anything.
      mockStdout({ value: [] })
      const injected = '/sub/rg/vm; $(touch /tmp/pwned); `id`'

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_cloud_metrics')!
      await tool.execute({ resource: injected, metric: 'CPU', window: '5m' }, creds())

      expect(execFile.mock.calls[0]![0]).toBe('az')
      const args = execFile.mock.calls[0]![1] as string[]
      // The injected resource must appear as one inert argv element
      expect(args).toContain(injected)
    })
  })

  // -- get_alarms -------------------------------------------------------------
  describe('get_alarms', () => {
    it('parses az monitor metrics alert list into {id,name,state,reason}', async () => {
      mockStdout(ALERTS_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: Array<Record<string, string>> }

      expect(result.alarms).toHaveLength(2)
      expect(result.alarms[0]).toEqual({
        id: 'High-CPU-alert',
        name: 'High-CPU-alert',
        state: 'Sev2', // enabled=true, severity=Sev2
        reason: 'Alert when CPU exceeds 80% on production VMs',
      })
      expect(result.alarms[1]).toEqual({
        id: 'Memory-low',
        name: 'Memory-low',
        state: 'Disabled', // enabled=false
        reason: 'Alert when available memory drops below 1GB',
      })
    })

    it('uses severity as state when enabled, "Disabled" when not enabled', async () => {
      const alertsNoSeverity = [
        {
          name: 'Simple-alert',
          enabled: true,
          // no severity field
          description: 'Simple alert without severity',
        },
      ]
      mockStdout(alertsNoSeverity)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: Array<Record<string, string>> }

      expect(result.alarms[0]!.state).toBe('Enabled')
    })

    it('uses condition summary as reason when no description', async () => {
      const alertsNoDesc = [
        {
          name: 'No-desc-alert',
          enabled: true,
          severity: 'Sev3',
          condition: {
            allOf: [{ metricName: 'CPU', operator: 'GreaterThan', threshold: 90 }],
          },
        },
      ]
      mockStdout(alertsNoDesc)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: Array<Record<string, string>> }

      expect(result.alarms[0]!.reason).toBe('CPU GreaterThan 90')
    })

    it('filters by service name (client-side)', async () => {
      mockStdout(ALERTS_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({ service: 'memory' }, creds()) as { alarms: Array<Record<string, string>> }

      expect(result.alarms).toHaveLength(1)
      expect(result.alarms[0]!.id).toBe('Memory-low')
    })

    it('returns empty alarms when no alerts exist', async () => {
      mockStdout(ALERTS_EMPTY_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: unknown[] }

      expect(result.alarms).toEqual([])
    })

    it('returns empty alarms on CLI failure', async () => {
      mockError('AccessDenied')

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      const result = await tool.execute({}, creds()) as { alarms: unknown[] }

      expect(result.alarms).toEqual([])
    })

    it('does not append service filter to CLI command (filtering is client-side)', async () => {
      mockStdout(ALERTS_EMPTY_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({ service: 'payments' }, creds())

      expect(execFile.mock.calls[0]![0]).toBe('az')
      const args = execFile.mock.calls[0]![1] as string[]
      // CLI argv is just az monitor metrics alert list --output json — no service filter
      expect(args).toContain('monitor')
      expect(args).toContain('metrics')
      expect(args).toContain('alert')
      expect(args).toContain('list')
      expect(args).toContain('--output')
      expect(args).toContain('json')
      expect(args).not.toContain('payments')
    })
  })

  // -- get_health_events ------------------------------------------------------
  describe('get_health_events', () => {
    it('parses ResourceHealth events into {service,region,status,message}', async () => {
      mockStdout(HEALTH_EVENTS_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: Array<Record<string, string>> }

      expect(result.events).toHaveLength(2)
      expect(result.events[0]).toEqual({
        service: 'Virtual Machines',
        region: 'East US',
        status: 'Active',
        message:
          'Starting at 10:00 UTC, you may experience network connectivity issues when accessing Virtual Machines in East US.',
      })
      expect(result.events[1]).toEqual({
        service: 'SQL Database',
        region: 'West Europe',
        status: 'Resolved',
        message:
          'Scheduled maintenance for SQL Database in West Europe. Minor latency impact expected.',
      })
    })

    it('constructs correct az rest argv array with subscriptionId', async () => {
      mockStdout(HEALTH_EMPTY_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await tool.execute({}, creds({ subscriptionId: 'my-sub-id' }))

      expect(execFile.mock.calls[0]![0]).toBe('az')
      const args = execFile.mock.calls[0]![1] as string[]
      expect(args).toContain('rest')
      expect(args).toContain('--method')
      expect(args).toContain('GET')
      expect(args).toContain('--url')
      // The URL is one complete argv element
      const urlArg = args[args.indexOf('--url') + 1]
      expect(urlArg).toContain('https://management.azure.com/subscriptions/my-sub-id/providers/Microsoft.ResourceHealth/events')
      expect(urlArg).toContain('api-version=2022-10-01')
      expect(urlArg).toContain('$filter=eventSource')
      expect(urlArg).toContain('ServiceHealth')
    })

    it('reads subscriptionId from creds.subscription_id as fallback', async () => {
      mockStdout(HEALTH_EMPTY_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await tool.execute({}, { subscription_id: 'from-snake-case' })

      const args = execFile.mock.calls[0]![1] as string[]
      const urlArg = args[args.indexOf('--url') + 1]
      expect(urlArg).toContain('/subscriptions/from-snake-case/')
    })

    it('prefers params.subscriptionId over creds.subscriptionId', async () => {
      mockStdout(HEALTH_EMPTY_OUTPUT)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      await tool.execute(
        { subscriptionId: 'from-params' },
        { subscriptionId: 'from-creds' },
      )

      const args = execFile.mock.calls[0]![1] as string[]
      const urlArg = args[args.indexOf('--url') + 1]
      expect(urlArg).toContain('/subscriptions/from-params/')
    })

    it('returns empty events when no subscriptionId available', async () => {
      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, {}) as { events: unknown[] }

      expect(result.events).toEqual([])
      expect(execFile).not.toHaveBeenCalled()
    })

    it('returns empty events on CLI failure', async () => {
      mockError('Resource provider not registered')

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: unknown[] }

      expect(result.events).toEqual([])
    })

    it('returns empty events on invalid JSON response', async () => {
      mockRawStdout('not json')

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: unknown[] }

      expect(result.events).toEqual([])
    })

    it('handles missing properties gracefully', async () => {
      const partialOutput = {
        value: [
          {
            name: 'bare-event',
            properties: {}, // no service, region, status, impactDescription
          },
        ],
      }
      mockStdout(partialOutput)

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_health_events')!
      const result = await tool.execute({}, creds()) as { events: Array<Record<string, string>> }

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toEqual({
        service: 'Unknown',
        region: 'global',
        status: 'unknown',
        message: 'No description',
      })
    })
  })

  // -- auth/env wiring --------------------------------------------------------
  describe('auth wiring', () => {
    it('sets AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID from creds', async () => {
      mockStdout([])

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute(
        {},
        creds({
          clientId: 'custom-client-id',
          clientSecret: 'super-secret',
          tenantId: 'custom-tenant-id',
        }),
      )

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AZURE_CLIENT_ID']).toBe('custom-client-id')
      expect(callEnv.env!['AZURE_CLIENT_SECRET']).toBe('super-secret')
      expect(callEnv.env!['AZURE_TENANT_ID']).toBe('custom-tenant-id')
    })

    it('omits env vars when creds fields missing', async () => {
      mockStdout([])

      const agent = new AzureMonitorAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alarms')!
      await tool.execute({}, {})

      const callEnv = execFile.mock.calls[0]![2] as { env?: Record<string, string> }
      expect(callEnv.env!['AZURE_CLIENT_ID']).toBeUndefined()
      expect(callEnv.env!['AZURE_CLIENT_SECRET']).toBeUndefined()
      expect(callEnv.env!['AZURE_TENANT_ID']).toBeUndefined()
    })
  })
})
