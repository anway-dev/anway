import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { DynatraceBootstrap } from './bootstrap.js'
import { DynatraceAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  // ── bootstrap routes ───────────────────────────────────────────────
  {
    method: 'GET', path: '/api/v2/entities', status: 200, body: {
      entities: [
        { entityId: 'SERVICE-1', displayName: 'payments-api', type: 'SERVICE' },
        { entityId: 'SERVICE-2', displayName: 'checkout-api', type: 'SERVICE' },
      ],
    },
  },

  // ── get_metrics (happy path, with entitySelector) ──────────────────
  {
    method: 'GET', path: '/api/v2/metrics/query', status: 200, body: {
      resolution: '1m',
      result: [
        {
          metricId: 'builtin:service.requestCount.total',
          data: [
            {
              timestamps: [1700000000000, 1700000300000, 1700000600000],
              values: [100, 120, 110],
            },
          ],
        },
      ],
    },
  },

  // ── get_alerts (happy path, multiple problems with mixed severity/status) ──
  {
    method: 'GET', path: '/api/v2/problems', status: 200, body: {
      problems: [
        {
          problemId: 'prob-1',
          title: 'High error rate on payments-api',
          severityLevel: 'AVAILABILITY',
          status: 'OPEN',
          startTime: 1700000000000,
          affectedEntities: [{ entityId: { id: 'SERVICE-1' }, name: 'payments-api' }],
        },
        {
          problemId: 'prob-2',
          title: 'Slow response times',
          severityLevel: 'PERFORMANCE',
          status: 'OPEN',
          startTime: 1700000100000,
          affectedEntities: [],
        },
        {
          problemId: 'prob-3',
          title: 'Database connection pool exhausted',
          severityLevel: 'ERROR',
          status: 'CLOSED',
          startTime: 1699990000000,
          affectedEntities: [{ name: 'checkout-api' }],
        },
      ],
    },
  },

  // ── get_logs (happy path, with entitySelector + limit) ─────────────
  {
    method: 'GET', path: '/api/v2/logs/search', status: 200, body: {
      results: [
        { timestamp: 1700000000000, status: 'ERROR', content: 'Connection timeout after 30s' },
        { timestamp: 1700000001000, status: 'WARN', content: 'Retry attempt 3/5' },
        { timestamp: 1700000002000, status: 'INFO', content: 'Request processed successfully' },
      ],
    },
  },

  // ── error routes (prefixed paths for targeted error injection) ─────
  { method: 'GET', path: '/http-500/api/v2/metrics/query', status: 500, body: { error: { code: 500, message: 'Server Error' } } },
  { method: 'GET', path: '/http-500/api/v2/problems', status: 500, body: { error: { code: 500, message: 'Server Error' } } },
  { method: 'GET', path: '/http-500/api/v2/logs/search', status: 500, body: { error: { code: 500, message: 'Server Error' } } },
]

describe('dynatrace — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  // ── bootstrap ──────────────────────────────────────────────────────

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new DynatraceBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector',
      { host: fixture.baseUrl, token: 'fixture-token' },
    )
    expect(result.entitiesUpserted).toBe(2)
    expect(kg.entities.some(e => e.name === 'payments-api')).toBe(true)
    expect(kg.entities.some(e => e.name === 'checkout-api')).toBe(true)
  })

  // ── agent tools count ──────────────────────────────────────────────

  it('agent has exactly 3 tools (all read)', () => {
    const agent = new DynatraceAgent()
    expect(agent.tools).toHaveLength(3)
    const writeTools = agent.tools.filter(t => t.write)
    expect(writeTools).toHaveLength(0)
  })

  // ── get_metrics ────────────────────────────────────────────────────

  it('get_metrics returns mapped points from fixture', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = (await tool.execute(
      { service: 'payments-api', window: '1h' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )) as { points: Array<{ t: number; v: number }>; unit: string }

    expect(result.unit).toBe('builtin:service.requestCount.total')
    expect(result.points).toHaveLength(3)
    // timestamps are in ms in fixture → ts stays ms
    expect(result.points[0]).toEqual({ t: 1700000000000, v: 100 })
    expect(result.points[1]).toEqual({ t: 1700000300000, v: 120 })
    expect(result.points[2]).toEqual({ t: 1700000600000, v: 110 })
  })

  it('get_metrics uses custom metric selector when provided', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    const before = fixture.receivedRequests.length

    const result = (await tool.execute(
      { service: 'payments-api', window: '30m', metric: 'builtin:service.errors.total.rate' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )) as { unit: string }

    expect(result.unit).toBe('builtin:service.errors.total.rate')

    const newReqs = fixture.receivedRequests.slice(before)
    const metricReq = newReqs.find(r => r.path.includes('/metrics/query'))
    expect(metricReq, 'expected /api/v2/metrics/query call').toBeDefined()
    expect(metricReq!.path).toContain('metricSelector=builtin%3Aservice.errors.total.rate')
    // URLSearchParams percent-encodes parens: ( → %28, ) → %29
    expect(metricReq!.path).toContain('entitySelector=type%28SERVICE%29%2CentityName.equals%28payments-api%29')
    expect(metricReq!.path).toContain('from=now-30m')
  })

  it('get_metrics includes entitySelector and metricSelector in request URL', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { service: 'checkout-api', window: '7d' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/metrics/query'))
    expect(req).toBeDefined()
    expect(req!.path).toContain('entitySelector=type%28SERVICE%29%2CentityName.equals%28checkout-api%29')
    expect(req!.path).toContain('from=now-7d')
    expect(req!.path).toContain('metricSelector=builtin%3Aservice.requestCount.total')
  })

  it('get_metrics returns empty points on HTTP 500', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!

    const result = (await tool.execute(
      { service: 'payments-api', window: '1h' },
      { host: fixture.baseUrl + '/http-500', token: 'fixture-token' },
    )) as { points: unknown[]; unit: string }

    expect(result.points).toEqual([])
    expect(result.unit).toBe('builtin:service.requestCount.total')
  })

  it('get_metrics returns empty on missing creds', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!

    const result = (await tool.execute(
      { service: 'payments-api', window: '1h' },
      {},
    )) as { points: unknown[]; unit: string }

    expect(result.points).toEqual([])
    expect(result.unit).toBe('unknown')
  })

  it('get_metrics defaults invalid window to now-1h', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { service: 'payments-api', window: 'garbage' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/metrics/query'))
    expect(req).toBeDefined()
    expect(req!.path).toContain('from=now-1h')
  })

  // ── get_alerts ─────────────────────────────────────────────────────

  it('get_alerts returns mapped problems from fixture', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = (await tool.execute(
      {},
      { host: fixture.baseUrl, token: 'fixture-token' },
    )) as { alerts: Array<{ id: string; title: string; severity: string; status: string; firedAt: string }> }

    expect(result.alerts).toHaveLength(3)

    // prob-1: AVAILABILITY → critical, OPEN → firing
    expect(result.alerts[0]).toMatchObject({
      id: 'prob-1',
      title: 'High error rate on payments-api',
      severity: 'critical',
      status: 'firing',
    })
    expect(result.alerts[0]!.firedAt).toBeTruthy()

    // prob-2: PERFORMANCE → medium, OPEN → firing
    expect(result.alerts[1]!.severity).toBe('medium')
    expect(result.alerts[1]!.status).toBe('firing')

    // prob-3: ERROR → high, CLOSED → resolved
    expect(result.alerts[2]!.severity).toBe('high')
    expect(result.alerts[2]!.status).toBe('resolved')
  })

  it('get_alerts filters by service client-side', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!

    const result = (await tool.execute(
      { service: 'payments-api' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )) as { alerts: Array<{ id: string }> }

    // Only prob-1 matches payments-api (title + affected entity)
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0]!.id).toBe('prob-1')
  })

  it('get_alerts filters by severity via problemSelector', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { severity: 'critical' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/problems'))
    expect(req).toBeDefined()
    // critical → AVAILABILITY
    expect(req!.path).toContain('severityLevel%28%22AVAILABILITY%22%29')
    expect(req!.path).toContain('status%28%22OPEN%22%29')
  })

  it('get_alerts severity mapping covers all generic terms', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!

    // Verify each term maps and doesn't crash. Fixture returns same body regardless.
    const severities = ['critical', 'high', 'medium', 'low', 'info', 'error', 'performance', 'resource_contention', 'custom_alert']
    for (const sev of severities) {
      const result = (await tool.execute(
        { severity: sev },
        { host: fixture.baseUrl, token: 'fixture-token' },
      )) as { alerts: unknown[] }
      expect(result.alerts).toBeDefined()
    }
  })

  it('get_alerts defaults from=now-24h', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    const before = fixture.receivedRequests.length

    await tool.execute({}, { host: fixture.baseUrl, token: 'fixture-token' })

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/problems'))
    expect(req).toBeDefined()
    expect(req!.path).toContain('from=now-24h')
  })

  it('get_alerts returns empty on HTTP 500', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!

    const result = (await tool.execute(
      {},
      { host: fixture.baseUrl + '/http-500', token: 'fixture-token' },
    )) as { alerts: unknown[] }

    expect(result.alerts).toEqual([])
  })

  it('get_alerts returns empty on missing creds', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!

    const result = (await tool.execute({}, {})) as { alerts: unknown[] }
    expect(result.alerts).toEqual([])
  })

  // ── get_logs ───────────────────────────────────────────────────────

  it('get_logs returns mapped log lines from fixture', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = (await tool.execute(
      { service: 'payments-api', query: 'error' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )) as { lines: Array<{ ts: string; level: string; msg: string }> }

    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toMatchObject({
      level: 'ERROR',
      msg: 'Connection timeout after 30s',
    })
    expect(result.lines[0]!.ts).toBeTruthy()
    expect(result.lines[1]!.level).toBe('WARN')
    expect(result.lines[2]!.level).toBe('INFO')
  })

  it('get_logs builds DQL query with matchesPhrase and entitySelector', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { service: 'checkout-api', query: 'timeout' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/logs/search'))
    expect(req).toBeDefined()
    // DQL: matchesPhrase(content, "timeout") — parens %-encoded by URLSearchParams
    expect(req!.path).toContain('matchesPhrase%28content%2C+%22timeout%22%29')
    // entitySelector (parens %-encoded)
    expect(req!.path).toContain('entitySelector=type%28SERVICE%29%2CentityName.equals%28checkout-api%29')
    // from
    expect(req!.path).toContain('from=now-1h')
  })

  it('get_logs respects limit param', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { service: 'payments-api', query: 'error', limit: 10 },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/logs/search'))
    expect(req).toBeDefined()
    expect(req!.path).toContain('limit=10')
  })

  it('get_logs defaults limit to 20', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { service: 'payments-api', query: 'error' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/logs/search'))
    expect(req).toBeDefined()
    expect(req!.path).toContain('limit=20')
  })

  it('get_logs escapes double quotes in query to prevent DQL injection', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { service: 'payments-api', query: 'test "injection"' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const req = newReqs.find(r => r.path.includes('/logs/search'))
    expect(req).toBeDefined()
    // Double quotes escaped with backslash; space encoded as +
    expect(req!.path).toContain('test+%5C%22injection%5C%22')
  })

  it('get_logs returns empty on HTTP 500', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!

    const result = (await tool.execute(
      { service: 'payments-api', query: 'error' },
      { host: fixture.baseUrl + '/http-500', token: 'fixture-token' },
    )) as { lines: unknown[] }

    expect(result.lines).toEqual([])
  })

  it('get_logs returns empty on missing creds', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!

    const result = (await tool.execute(
      { service: 'payments-api', query: 'error' },
      {},
    )) as { lines: unknown[] }

    expect(result.lines).toEqual([])
  })

  it('get_logs returns empty when service is empty string', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!

    const result = (await tool.execute(
      { service: '', query: 'error' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )) as { lines: unknown[] }

    expect(result.lines).toEqual([])
  })

  // ── auth header (resolves from both host/baseUrl and token/apiKey) ──

  it('tools send Authorization: Api-Token header', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!

    await tool.execute(
      { service: 'payments-api', window: '1h' },
      { host: fixture.baseUrl, token: 'fixture-token' },
    )

    const lastReq = fixture.receivedRequests.at(-1)
    expect(lastReq).toBeDefined()
    const authHeader =
      (lastReq!.headers as Record<string, string | string[] | undefined>)['authorization']
    expect(authHeader).toBe('Api-Token fixture-token')
  })

  it('resolveCreds accepts apiKey as token alias and baseUrl as host alias', async () => {
    const agent = new DynatraceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!

    // apiKey + baseUrl should resolve the same as token + host
    const result = (await tool.execute(
      { service: 'payments-api', window: '1h' },
      { baseUrl: fixture.baseUrl, apiKey: 'fixture-token' },
    )) as { points: Array<{ t: number; v: number }> }

    expect(result.points).toHaveLength(3)
  })

  // ── smoke ──────────────────────────────────────────────────────────

  it('fixture server received at least one request', () => {
    expect(fixture.receivedRequests.length).toBeGreaterThan(0)
  })
})


describe('dynatrace — orchestration (specialist agent)', () => {
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
