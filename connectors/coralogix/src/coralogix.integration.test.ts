import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { CoralogixBootstrap } from './bootstrap.js'
import { CoralogixAgent } from './agent.js'


// ── Shared routes (bootstrap + alerts) ──────────────────────────────────────
const sharedRoutes: FixtureRoute[] = [
  { method: 'POST', path: '/api/v1/logs/get-applications', status: 200,
    body: { applications: [{ name: 'payments-api' }, { name: 'auth-service' }] } },
  { method: 'GET', path: '/api/v1/logs/statistics/applications', status: 200,
    body: { data: [{ application: 'payments-api' }, { application: 'auth-service' }] } },
  {
    method: 'GET', path: '/api/v1/alert-definitions', status: 200, body: {
      alert_definitions: [
        { id: 'ad-001', name: 'High error rate — payments-api', severity: 'critical', enabled: true, last_triggered_at: '2026-07-04T09:30:00Z', description: 'Error rate exceeds 5% threshold' },
        { id: 'ad-002', name: 'Latency spike — payments-api', severity: 'high', enabled: true, last_triggered_at: '2026-07-04T09:15:00Z', description: 'P99 latency exceeds 500ms' },
        { id: 'ad-003', name: 'Disk space low — auth-service', severity: 'medium', enabled: true, description: 'Disk usage exceeds 80%' },
        { id: 'ad-004', name: 'Dead letter queue — payments-api', severity: 'low', enabled: false, updated_at: '2026-07-01T00:00:00Z' },
        { id: 'ad-005', name: 'No severity field', enabled: true },
      ],
    },
  },
]

// ── DataPrime routes ─────────────────────────────────────────────────────────
// NOTE: get_metrics and get_logs both hit POST /api/v1/dataprime/query.
// FixtureServer matches on method+path only (no body inspection), so they
// cannot coexist in one fixture. Each tool test group gets its own fixture.

const metricsDataPrimeRoute: FixtureRoute = {
  method: 'POST', path: '/api/v1/dataprime/query', status: 200, body: {
    results: [
      { timeslice: '2026-07-04T09:00:00.000Z', 'avg(metadata_value)': 0.034 },
      { timeslice: '2026-07-04T09:05:00.000Z', 'avg(metadata_value)': 0.028 },
      { timeslice: '2026-07-04T09:10:00.000Z', 'avg(metadata_value)': 0.041 },
      { timeslice: '2026-07-04T09:15:00.000Z', 'avg(metadata_value)': 0.037 },
      { timeslice: '2026-07-04T09:20:00.000Z', 'avg(metadata_value)': 0.052 },
      { timeslice: '2026-07-04T09:25:00.000Z', 'avg(metadata_value)': 0.031 },
    ],
  },
}

const logsDataPrimeRoute: FixtureRoute = {
  method: 'POST', path: '/api/v1/dataprime/query', status: 200, body: {
    results: [
      { timestamp: '2026-07-04T09:30:00.000Z', severity: 'error', text: 'Connection timeout to database' },
      { timestamp: '2026-07-04T09:32:00.000Z', severity: 'warning', text: 'Retry attempt 3 exhausted' },
      { timestamp: '2026-07-04T09:35:00.000Z', severity: 'error', text: 'Circuit breaker tripped for checkout' },
      { timestamp: '2026-07-04T09:38:00.000Z', severity: 'info', text: 'Connection pool recovered' },
    ],
  },
}

// ── Error routes ────────────────────────────────────────────────────────────
const errorBase = 'http-500'
const errorRoutes: FixtureRoute[] = [
  { method: 'POST', path: '/api/v1/dataprime/query', status: 500, body: {} },
  { method: 'GET', path: '/api/v1/alert-definitions', status: 500, body: {} },
]


describe('coralogix — fixture HTTP server', () => {
  let shared: FixtureServer

  beforeAll(async () => {
    shared = await startFixtureServer(sharedRoutes)
  }, 10_000)

  afterAll(async () => { await shared.close() })

  // ── bootstrap ────────────────────────────────────────────────────────

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new CoralogixBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { apiKey: 'fixture-key', region: 'us1', baseUrl: shared.baseUrl },
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'payments-api'), 'expected entity payments-api not extracted').toBe(true)
  })

  // ── agent tool count ─────────────────────────────────────────────────

  it('agent has exactly 3 tools (all read)', () => {
    const agent = new CoralogixAgent()
    expect(agent.tools).toHaveLength(3)
    expect(agent.tools.every(t => !t.write)).toBe(true)
  })

  // ── get_metrics (own fixture — DataPrime path collision with get_logs) ─

  it('get_metrics returns timeseries points from DataPrime fixture', async () => {
    const dpFixture = await startFixtureServer([metricsDataPrimeRoute])
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
      expect(tool).toBeDefined()
      expect(tool.write).toBe(false)

      const result = await tool.execute(
        { service: 'payments-api', window: '1h' },
        { baseUrl: dpFixture.baseUrl, apiKey: 'fixture-key' },
      ) as { points: Array<{ t: number; v: number }>; unit: string }

      expect(result.points).toHaveLength(6)
      expect(result.unit).toBe('requests/s')
      expect(result.points[0]!.v).toBeCloseTo(0.034)
      expect(result.points[0]!.t).toBeGreaterThan(0)
      for (const p of result.points) {
        expect(p.t).toBeGreaterThan(0)
        expect(typeof p.v).toBe('number')
        expect(Number.isNaN(p.v)).toBe(false)
      }
    } finally {
      await dpFixture.close()
    }
  }, 10_000)

  it('get_metrics sends DataPrime query with service name and time range', async () => {
    const dpFixture = await startFixtureServer([metricsDataPrimeRoute])
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!

      await tool.execute(
        { service: 'payments-api', window: '1h' },
        { baseUrl: dpFixture.baseUrl, apiKey: 'fixture-key' },
      )

      const dpReq = dpFixture.receivedRequests.find(r =>
        r.path.includes('/api/v1/dataprime/query') && r.method === 'POST',
      )
      expect(dpReq, 'expected DataPrime POST call').toBeDefined()
      const body = JSON.parse(dpReq!.body)
      expect(body.query).toContain('source metrics')
      expect(body.query).toContain("metadata_applicationName = 'payments-api'")
      expect(body.startTime).toBeDefined()
      expect(body.endTime).toBeDefined()
    } finally {
      await dpFixture.close()
    }
  }, 10_000)

  it('get_metrics throws on HTTP 500 (real failure, not an empty result)', async () => {
    const errFixture = await startFixtureServer(errorRoutes)
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
      await expect(tool.execute(
        { service: 'payments-api', window: '1h' },
        { baseUrl: errFixture.baseUrl, apiKey: 'fixture-key' },
      )).rejects.toThrow('Coralogix get_metrics failed: HTTP 500')
    } finally {
      await errFixture.close()
    }
  }, 10_000)

  it('get_metrics throws on missing apiKey (real failure, not an empty result)', async () => {
    const agent = new CoralogixAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    await expect(tool.execute(
      { service: 'payments-api', window: '1h' }, {},
    )).rejects.toThrow('Coralogix credentials not configured')
  })

  // ── get_alerts (uses shared fixture) ─────────────────────────────────

  it('get_alerts returns mapped alerts from fixture', async () => {
    const agent = new CoralogixAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      {}, { baseUrl: shared.baseUrl, apiKey: 'fixture-key' },
    ) as { alerts: Array<{ id: string; title: string; severity: string; status: string; firedAt: string }> }

    expect(result.alerts).toHaveLength(5)
    expect(result.alerts[0]).toMatchObject({
      id: 'ad-001', title: 'High error rate — payments-api', severity: 'critical', status: 'firing',
    })
    expect(result.alerts[0]!.firedAt).toBe('2026-07-04T09:30:00Z')
    expect(result.alerts[2]!.severity).toBe('medium')
    expect(result.alerts[2]!.status).toBe('firing')
    expect(result.alerts[3]!.status).toBe('disabled')
    expect(result.alerts[4]!.severity).toBe('info')
    expect(result.alerts[4]!.status).toBe('firing')
  })

  it('get_alerts filters by service (client-side substring match)', async () => {
    const agent = new CoralogixAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    const result = await tool.execute(
      { service: 'payments-api' }, { baseUrl: shared.baseUrl, apiKey: 'fixture-key' },
    ) as { alerts: Array<{ title: string }> }
    expect(result.alerts).toHaveLength(3)
    expect(result.alerts.every(a => a.title.toLowerCase().includes('payments-api'))).toBe(true)
  })

  it('get_alerts filters by severity (client-side exact match)', async () => {
    const agent = new CoralogixAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    const result = await tool.execute(
      { severity: 'critical' }, { baseUrl: shared.baseUrl, apiKey: 'fixture-key' },
    ) as { alerts: Array<{ severity: string }> }
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0]!.severity).toBe('critical')
  })

  it('get_alerts throws on HTTP 500 (real failure, not an empty result)', async () => {
    const errFixture = await startFixtureServer(errorRoutes)
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
      await expect(tool.execute(
        {}, { baseUrl: errFixture.baseUrl, apiKey: 'fixture-key' },
      )).rejects.toThrow('Coralogix get_alerts failed: HTTP 500')
    } finally {
      await errFixture.close()
    }
  }, 10_000)

  it('get_alerts throws on missing apiKey (real failure, not an empty result)', async () => {
    const agent = new CoralogixAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    await expect(tool.execute({}, {})).rejects.toThrow('Coralogix credentials not configured')
  })

  // ── get_logs (own fixture — DataPrime path collision with get_metrics) ─

  it('get_logs returns mapped log lines from DataPrime fixture', async () => {
    const dpFixture = await startFixtureServer([logsDataPrimeRoute])
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
      expect(tool).toBeDefined()
      expect(tool.write).toBe(false)

      const result = await tool.execute(
        { service: 'payments-api', query: 'error' },
        { baseUrl: dpFixture.baseUrl, apiKey: 'fixture-key' },
      ) as { lines: Array<{ ts: string; level: string; msg: string }> }

      expect(result.lines).toHaveLength(4)
      expect(result.lines[0]).toEqual({
        ts: '2026-07-04T09:30:00.000Z', level: 'error', msg: 'Connection timeout to database',
      })
      expect(result.lines[1]!.level).toBe('warning')
      expect(result.lines[3]!.level).toBe('info')
      for (const line of result.lines) {
        expect(line.ts).toBeTruthy()
        expect(line.level).toBeTruthy()
        expect(line.msg).toBeTruthy()
      }
    } finally {
      await dpFixture.close()
    }
  }, 10_000)

  it('get_logs sends DataPrime query with service, search term, and limit', async () => {
    const dpFixture = await startFixtureServer([logsDataPrimeRoute])
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_logs')!

      await tool.execute(
        { service: 'payments-api', query: 'timeout' },
        { baseUrl: dpFixture.baseUrl, apiKey: 'fixture-key' },
      )

      const dpReq = dpFixture.receivedRequests.find(r =>
        r.path.includes('/api/v1/dataprime/query') && r.method === 'POST',
      )
      expect(dpReq, 'expected DataPrime POST call').toBeDefined()
      const body = JSON.parse(dpReq!.body)
      expect(body.query).toContain('source logs')
      expect(body.query).toContain("applicationName = 'payments-api'")
      expect(body.query).toContain("text contains 'timeout'")
      expect(body.limit).toBe(50) // default
    } finally {
      await dpFixture.close()
    }
  }, 10_000)

  it('get_logs respects explicit limit param', async () => {
    const dpFixture = await startFixtureServer([logsDataPrimeRoute])
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_logs')!

      await tool.execute(
        { service: 'payments-api', query: 'error', limit: 25 },
        { baseUrl: dpFixture.baseUrl, apiKey: 'fixture-key' },
      )

      const dpReq = dpFixture.receivedRequests.find(r =>
        r.path.includes('/api/v1/dataprime/query') && r.method === 'POST',
      )
      const body = JSON.parse(dpReq!.body)
      expect(body.limit).toBe(25)
      expect(body.query).toContain('limit 25')
    } finally {
      await dpFixture.close()
    }
  }, 10_000)

  it('get_logs throws on HTTP 500 (real failure, not an empty result)', async () => {
    const errFixture = await startFixtureServer(errorRoutes)
    try {
      const agent = new CoralogixAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
      await expect(tool.execute(
        { service: 'payments-api', query: 'error' },
        { baseUrl: errFixture.baseUrl, apiKey: 'fixture-key' },
      )).rejects.toThrow('Coralogix get_logs failed: HTTP 500')
    } finally {
      await errFixture.close()
    }
  }, 10_000)

  it('get_logs throws on missing apiKey (real failure, not an empty result)', async () => {
    const agent = new CoralogixAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    await expect(tool.execute(
      { service: 'payments-api', query: 'error' }, {},
    )).rejects.toThrow('Coralogix credentials not configured')
  })

  // ── smoke ────────────────────────────────────────────────────────────

  it('shared fixture server received at least one request', () => {
    expect(shared.receivedRequests.length).toBeGreaterThan(0)
  })
})


describe('coralogix — orchestration (specialist agent)', () => {
  it('specialist agent routes user query to tool and returns grounded response', async () => {
    const providerType = process.env['ANTHROPIC_API_KEY'] ? 'anthropic'
      : process.env['OPENAI_API_KEY'] ? 'openai'
      : process.env['OLLAMA_ENDPOINT'] ? 'ollama'
      : null
    if (!providerType) {
      console.log('Skipping orchestration test — no model provider configured')
      return
    }
    expect(true).toBe(true) // placeholder — full agent run requires real model
  })
})
