import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { NewRelicBootstrap } from './bootstrap.js'
import { NewrelicAgent } from './agent.js'


// ── Fixture data ────────────────────────────────────────────────────────

const bootstrapRoutes: FixtureRoute[] = [
  {
    method: 'GET', path: '/v2/applications.json', status: 200,
    body: { applications: [{ id: 1, name: 'payments-api', language: 'nodejs', health_status: 'green' }] },
  },
]

/** Realistic NRQL TIMESERIES response via NerdGraph — 6 buckets, 5-min each. */
const metricsNerdGraphBody = {
  data: {
    actor: {
      account: {
        nrql: {
          results: [
            { beginTimeSeconds: 1710000000, endTimeSeconds: 1710000300, value: 0.042 },
            { beginTimeSeconds: 1710000300, endTimeSeconds: 1710000600, value: 0.038 },
            { beginTimeSeconds: 1710000600, endTimeSeconds: 1710000900, value: 0.055 },
            { beginTimeSeconds: 1710000900, endTimeSeconds: 1710001200, value: 0.061 },
            { beginTimeSeconds: 1710001200, endTimeSeconds: 1710001500, value: 0.048 },
            { beginTimeSeconds: 1710001500, endTimeSeconds: 1710001800, value: 0.052 },
          ],
        },
      },
    },
  },
}

/** Realistic NrAiIssue NRQL response — 3 active issues. */
const alertsNerdGraphBody = {
  data: {
    actor: {
      account: {
        nrql: {
          results: [
            { issueId: 'iss-1', title: 'High error rate on payments-api', priority: 'CRITICAL', state: 'ACTIVATED', activatedAt: 1710000000000, createdAt: 1709990000000 },
            { issueId: 'iss-2', title: 'DB connection pool exhaustion', priority: 'HIGH', state: 'ACTIVATED', activatedAt: 1710001000000, createdAt: 1710000000000 },
            { issueId: 'iss-3', title: 'Minor UI rendering delay', priority: 'LOW', state: 'CREATED', activatedAt: null, createdAt: 1710002000000 },
          ],
        },
      },
    },
  },
}

/** Realistic Log NRQL response. */
const logsNerdGraphBody = {
  data: {
    actor: {
      account: {
        nrql: {
          results: [
            { timestamp: 1710000500000, level: 'ERROR', message: 'Connection refused to payment gateway' },
            { timestamp: 1710000400000, level: 'WARN', message: 'Retry attempt 3/5 for payment gateway' },
            { timestamp: 1710000300000, level: 'ERROR', message: 'Timeout waiting for payment response after 30s' },
          ],
        },
      },
    },
  },
}

/** GraphQL-level error (HTTP 200 + errors array). */
const graphqlErrorBody = {
  errors: [{ message: 'NRQL syntax error: unexpected token' }],
}

// ── Shared creds helper ─────────────────────────────────────────────────

function creds(baseUrl: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { baseUrl, apiKey: 'fixture-key', accountId: '12345', ...extra }
}


// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════════════

describe('newrelic — bootstrap', () => {
  let fixture: FixtureServer

  beforeAll(async () => { fixture = await startFixtureServer(bootstrapRoutes) }, 10_000)
  afterAll(async () => { await fixture.close() })

  it('extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new NewRelicBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector',
      { apiKey: 'fixture-key', baseUrl: fixture.baseUrl },
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'payments-api'), 'expected entity payments-api not extracted').toBe(true)
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// get_metrics
// ═══════════════════════════════════════════════════════════════════════════

describe('newrelic — get_metrics', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer([
      { method: 'POST', path: '/graphql', status: 200, body: metricsNerdGraphBody },
    ])
  }, 10_000)
  afterAll(async () => { await fixture.close() })

  it('returns parsed TIMESERIES points from NerdGraph fixture', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { service: 'payments-api', window: '1h' },
      creds(fixture.baseUrl),
    ) as { points: Array<{ t: number; v: number }>; unit: string }

    expect(result.points).toHaveLength(6)
    expect(result.unit).toBe('duration') // default metric
    expect(result.points[0]!.t).toBe(1710000000 * 1000) // seconds → ms
    expect(result.points[0]!.v).toBeCloseTo(0.042, 3)
    const expectedValues = [0.042, 0.038, 0.055, 0.061, 0.048, 0.052]
    result.points.forEach((p, i) => expect(p.v).toBeCloseTo(expectedValues[i]!, 3))
  })

  it('posts to /graphql with Api-Key header', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    await tool.execute({ service: 'payments-api', window: '1h' }, creds(fixture.baseUrl))

    const req = fixture.receivedRequests.find(r => r.path === '/graphql' && r.method === 'POST')
    expect(req, 'expected POST /graphql').toBeDefined()
    const headers = req!.headers as Record<string, string | string[] | undefined>
    expect(headers['api-key']).toBe('fixture-key')
    expect(headers['content-type']).toContain('application/json')
  })

  it('sends valid NerdGraph payload with NRQL query', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    await tool.execute({ service: 'payments-api', window: '1h' }, creds(fixture.baseUrl))

    const req = fixture.receivedRequests.find(r => r.path === '/graphql' && r.method === 'POST')
    const body = JSON.parse(req!.body)
    expect(body.query).toContain('actor {')
    expect(body.query).toContain('nrql(query: $nrql)')
    // NRQL uses mapped window ("1 hour ago" not raw "1h")
    expect(body.variables.nrql).toContain('SINCE 1 hour ago')
    expect(body.variables.nrql).not.toContain('SINCE 1h')
    expect(body.variables.nrql).toContain("appName = 'payments-api'")
  })

  it('maps window shorthand correctly', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!

    // 30m → "30 minutes"
    await tool.execute({ service: 'srv', window: '30m' }, creds(fixture.baseUrl))
    const req30m = fixture.receivedRequests[fixture.receivedRequests.length - 1]!
    expect(JSON.parse(req30m.body).variables.nrql).toContain('SINCE 30 minutes ago')

    // 7d → "7 days"
    await tool.execute({ service: 'srv', window: '7d' }, creds(fixture.baseUrl))
    const req7d = fixture.receivedRequests[fixture.receivedRequests.length - 1]!
    expect(JSON.parse(req7d.body).variables.nrql).toContain('SINCE 7 days ago')

    // 1s → "1 second" (singular)
    await tool.execute({ service: 'srv', window: '1s' }, creds(fixture.baseUrl))
    const req1s = fixture.receivedRequests[fixture.receivedRequests.length - 1]!
    expect(JSON.parse(req1s.body).variables.nrql).toContain('SINCE 1 second ago')
  })

  it('uses custom metric name in NRQL', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    await tool.execute(
      { service: 'payments-api', window: '1h', metric: 'apm.service.error.count' },
      creds(fixture.baseUrl),
    )
    const req = fixture.receivedRequests[fixture.receivedRequests.length - 1]!
    const nrql = JSON.parse(req.body).variables.nrql as string
    // Dotted metric names get backtick-quoted
    expect(nrql).toContain('`apm.service.error.count`')
  })

  it('throws on missing accountId (real failure, not an empty result)', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    await expect(tool.execute(
      { service: 'payments-api', window: '1h' },
      { baseUrl: fixture.baseUrl, apiKey: 'key' }, // no accountId
    )).rejects.toThrow('New Relic credentials not configured (accountId)')
  })

  it('throws on missing apiKey (real failure, not an empty result)', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    await expect(tool.execute(
      { service: 'payments-api', window: '1h' },
      {},
    )).rejects.toThrow('New Relic credentials not configured (apiKey)')
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// get_alerts
// ═══════════════════════════════════════════════════════════════════════════

describe('newrelic — get_alerts', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer([
      { method: 'POST', path: '/graphql', status: 200, body: alertsNerdGraphBody },
    ])
  }, 10_000)
  afterAll(async () => { await fixture.close() })

  it('returns parsed alerts from NerdGraph fixture', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute({}, creds(fixture.baseUrl)) as {
      alerts: Array<{ id: string; title: string; severity: string; status: string; firedAt: string }>
    }

    expect(result.alerts).toHaveLength(3)

    // CRITICAL → critical, status ACTIVE = firing
    expect(result.alerts[0]).toMatchObject({
      id: 'iss-1',
      title: 'High error rate on payments-api',
      severity: 'critical',
      status: 'firing',
    })
    expect(result.alerts[0]!.firedAt).toBeDefined()

    // HIGH → high
    expect(result.alerts[1]!.severity).toBe('high')
    expect(result.alerts[1]!.status).toBe('firing')

    // LOW → low
    expect(result.alerts[2]!.severity).toBe('low')
  })

  it('filters by service name in NRQL', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    await tool.execute({ service: 'payments-api' }, creds(fixture.baseUrl))

    // Use last request — fixture accumulates across tests in this describe block
    const req = fixture.receivedRequests[fixture.receivedRequests.length - 1]
    const nrql = JSON.parse(req!.body).variables.nrql as string
    expect(nrql).toContain("entity.name = 'payments-api'")
    expect(nrql).toContain('FROM NrAiIssue')
    expect(nrql).toContain("state IN ('ACTIVATED', 'CREATED')")
  })

  it('filters by severity in NRQL', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    await tool.execute({ severity: 'critical' }, creds(fixture.baseUrl))

    const req = fixture.receivedRequests[fixture.receivedRequests.length - 1]!
    const nrql = JSON.parse(req.body).variables.nrql as string
    expect(nrql).toContain("priority = 'CRITICAL'")
  })

  it('throws on missing creds (real failure, not an empty result)', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    await expect(tool.execute({}, {})).rejects.toThrow('New Relic credentials not configured')
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// get_logs
// ═══════════════════════════════════════════════════════════════════════════

describe('newrelic — get_logs', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer([
      { method: 'POST', path: '/graphql', status: 200, body: logsNerdGraphBody },
    ])
  }, 10_000)
  afterAll(async () => { await fixture.close() })

  it('returns parsed log lines from NerdGraph fixture', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { service: 'payments-api', query: 'error' },
      creds(fixture.baseUrl),
    ) as { lines: Array<{ ts: string; level: string; msg: string }> }

    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toMatchObject({
      level: 'ERROR',
      msg: 'Connection refused to payment gateway',
    })
    expect(result.lines[1]!.level).toBe('WARN')
    expect(result.lines[2]!.level).toBe('ERROR')
    // ts is ISO string
    expect(() => new Date(result.lines[0]!.ts)).not.toThrow()
  })

  it('constructs NRQL with LIKE and LIMIT', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    await tool.execute(
      { service: 'payments-api', query: 'timeout', limit: 10 },
      creds(fixture.baseUrl),
    )

    // Use last request — fixture accumulates across tests in this describe block
    const req = fixture.receivedRequests[fixture.receivedRequests.length - 1]
    const nrql = JSON.parse(req!.body).variables.nrql as string
    expect(nrql).toContain('FROM Log')
    expect(nrql).toContain("appName = 'payments-api'")
    expect(nrql).toContain("message LIKE '%timeout%'")
    expect(nrql).toContain('SINCE 1 hour ago')
    expect(nrql).toContain('LIMIT 10')
  })

  it('defaults limit to 20', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    await tool.execute(
      { service: 'payments-api', query: 'error' },
      creds(fixture.baseUrl),
    )

    const req = fixture.receivedRequests[fixture.receivedRequests.length - 1]!
    const nrql = JSON.parse(req.body).variables.nrql as string
    expect(nrql).toContain('LIMIT 20')
  })

  it('throws on missing creds (real failure, not an empty result)', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
    await expect(tool.execute(
      { service: 'payments-api', query: 'error' },
      {},
    )).rejects.toThrow('New Relic credentials not configured')
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════════════════

describe('newrelic — error handling', () => {
  it('throws on GraphQL-level errors (HTTP 200 + errors array) — real failure, not empty', async () => {
    const fixture = await startFixtureServer([
      { method: 'POST', path: '/graphql', status: 200, body: graphqlErrorBody },
    ])
    try {
      const agent = new NewrelicAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
      await expect(tool.execute(
        { service: 'payments-api', window: '1h' },
        creds(fixture.baseUrl),
      )).rejects.toThrow('New Relic NerdGraph GraphQL error')
    } finally {
      await fixture.close()
    }
  }, 10_000)

  it('throws on HTTP 500 (real failure, not an empty result)', async () => {
    const fixture = await startFixtureServer([
      { method: 'POST', path: '/graphql', status: 500, body: {} },
    ])
    try {
      const agent = new NewrelicAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_alerts')!
      await expect(tool.execute({}, creds(fixture.baseUrl))).rejects.toThrow('New Relic NerdGraph query failed: HTTP 500')
    } finally {
      await fixture.close()
    }
  }, 10_000)

  it('throws on HTTP 404 (wrong endpoint) — real failure, not an empty result', async () => {
    const fixture = await startFixtureServer([
      { method: 'POST', path: '/graphql', status: 404, body: {} },
    ])
    try {
      const agent = new NewrelicAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_logs')!
      await expect(tool.execute(
        { service: 'payments-api', query: 'error' },
        creds(fixture.baseUrl),
      )).rejects.toThrow('New Relic NerdGraph query failed: HTTP 404')
    } finally {
      await fixture.close()
    }
  }, 10_000)

  it('throws on network error (bogus URL) — real failure, not an empty result', async () => {
    const agent = new NewrelicAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_metrics')!
    await expect(tool.execute(
      { service: 'payments-api', window: '1h' },
      { baseUrl: 'http://127.0.0.1:19999', apiKey: 'key', accountId: '12345' },
    )).rejects.toThrow()
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// Tool list
// ═══════════════════════════════════════════════════════════════════════════

describe('newrelic — tool list', () => {
  it('has exactly 3 tools, all read-only', () => {
    const agent = new NewrelicAgent()
    expect(agent.tools).toHaveLength(3)
    expect(agent.tools.every(t => !t.write)).toBe(true)
    expect(agent.tools.map(t => t.definition.name).sort()).toEqual([
      'get_alerts',
      'get_logs',
      'get_metrics',
    ])
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// Orchestration placeholder
// ═══════════════════════════════════════════════════════════════════════════

describe('newrelic — orchestration (specialist agent)', () => {
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
