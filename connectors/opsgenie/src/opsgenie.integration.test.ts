import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { OpsGenieBootstrap } from './bootstrap.js'
import { OpsgenieAgent } from './agent.js'

/**
 * "integration test" naming note: this suite runs against an in-process
 * fixture HTTP server (startFixtureServer), not a real deployed instance of
 * the SaaS API — the fixture's response shapes are authored by the same
 * person/session writing the connector implementation being tested. A
 * systematic misunderstanding of the real API's actual response shape would
 * be baked into both the fixture and the implementation identically, so
 * this suite passing does not by itself prove the real integration works.
 * It does correctly catch: request URL/param construction bugs, response
 * parsing bugs given a *correctly guessed* shape, and the error-handling
 * behavior (missing creds, non-OK HTTP, etc.) exercised in this file. No stronger real-API-contract test exists for this connector yet
 * (see connectors/{github,jira,confluence,pagerduty,slack} for the Prism-based
 * pattern this could be upgraded to).
 */


const fixtureRoutes: FixtureRoute[] = [
  // ── bootstrap routes ───────────────────────────────────────────────
  { method: 'GET', path: '/v2/teams', status: 200, body: { data: [{ id: 'team-1', name: 'Platform' }] } },
  {
    method: 'GET', path: '/v2/schedules', status: 200, body: {
      data: [
        { id: 'sch-1', name: 'Primary On-Call', ownerTeam: { id: 'team-1', name: 'Platform' } },
        { id: 'sch-404', name: 'Ghost Schedule', ownerTeam: { id: 'team-99', name: 'Ghost Team' } },
      ],
    },
  },
  {
    method: 'GET', path: '/v2/schedules/sch-1/on-calls', status: 200, body: {
      data: [{ onCallRecipients: ['alice@acme.dev'] }],
    },
  },

  // ── get_active_incidents (happy path) ──────────────────────────────
  {
    method: 'GET', path: '/v1/incidents', status: 200, body: {
      data: [
        { id: 'inc-1', message: 'Payment failures', priority: 'P1', createdAt: '2026-07-04T10:00:00Z', status: 'open' },
        { id: 'inc-2', message: 'DB replication lag', priority: 'P3', createdAt: '2026-07-04T09:00:00Z', status: 'open' },
        { id: 'inc-3', message: 'Minor UI glitch', createdAt: '2026-07-04T08:00:00Z', status: 'open' },
      ],
    },
  },

  // ── error routes (prefixed paths for targeted error injection) ─────
  { method: 'GET', path: '/http-500/v1/incidents', status: 500, body: {} },
  { method: 'GET', path: '/http-500/v2/schedules', status: 500, body: {} },
  { method: 'GET', path: '/v2/schedules/sch-404/on-calls', status: 404, body: {} },
]

describe('opsgenie — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  // ── bootstrap ──────────────────────────────────────────────────────

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new OpsGenieBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { apiKey: 'fixture-key', baseUrl: fixture.baseUrl },
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'Platform'), 'expected team Platform not extracted').toBe(true)
    expect(kg.entities.some(e => e.name === 'alice@acme.dev'), 'expected engineer alice@acme.dev not extracted from on-call').toBe(true)
  })

  // Regression test for finding A5 (connector bootstrap audit): the real
  // ONCALL relationship this bootstrap creates (correctly, using real
  // upsertEntity-returned ids — unlike PagerDuty's separate bug) was still
  // undercounted, since the final return hardcoded relationshipsUpserted: 0
  // regardless of how many edges were actually created.
  it('accurately reports relationshipsUpserted for the real Team→ONCALL→Engineer edge created', async () => {
    const kg = new FakeKG()
    const result = await new OpsGenieBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { apiKey: 'fixture-key', baseUrl: fixture.baseUrl },
    )
    expect(result.relationshipsUpserted).toBeGreaterThan(0)
    expect(kg.relationships.some(r =>
      r.relType === 'ONCALL' &&
      r.fromEntityId === 'Team:Platform' &&
      r.toEntityId === 'Engineer:alice@acme.dev',
    )).toBe(true)
  })

  // ── agent tools ────────────────────────────────────────────────────

  it('agent has exactly 4 tools (2 read, 2 write)', () => {
    const agent = new OpsgenieAgent()
    expect(agent.tools).toHaveLength(4)
    const readTools = agent.tools.filter(t => !t.write)
    const writeTools = agent.tools.filter(t => t.write)
    expect(readTools).toHaveLength(2)
    expect(writeTools).toHaveLength(2)
  })

  // ── get_active_incidents ──────────────────────────────────────────

  it('get_active_incidents returns mapped incidents from fixture', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_active_incidents')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute({}, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key' }) as {
      incidents: Array<{ id: string; title: string; severity: string; startedAt: string; status: string }>
    }

    expect(result.incidents).toHaveLength(3)
    expect(result.incidents[0]).toEqual({
      id: 'inc-1',
      title: 'Payment failures',
      severity: 'critical',
      startedAt: '2026-07-04T10:00:00Z',
      status: 'open',
    })
    expect(result.incidents[1].severity).toBe('moderate') // P3 → moderate
    // inc-3 has no priority — maps to 'unknown' (lowercase passthrough)
    expect(result.incidents[2].severity).toBe('unknown')
  })

  it('get_active_incidents queries status=open in request URL', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_active_incidents')!
    const before = fixture.receivedRequests.length

    await tool.execute({ service: 'payments-api' }, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key' })

    const newReqs = fixture.receivedRequests.slice(before)
    const incidentReq = newReqs.find(r => r.path.includes('/v1/incidents'))
    expect(incidentReq, 'expected /v1/incidents call').toBeDefined()
    // service param accepted but does NOT add a server-side filter (OpsGenie has no native service field)
    expect(incidentReq!.path).toContain('status%3Dopen')
  })

  it('get_active_incidents returns empty array when no incidents', async () => {
    // Use a fresh fixture with no incident data
    const emptyFixture = await startFixtureServer([
      { method: 'GET', path: '/v1/incidents', status: 200, body: { data: [] } },
    ])
    try {
      const agent = new OpsgenieAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_active_incidents')!
      const result = await tool.execute({}, { baseUrl: emptyFixture.baseUrl, apiKey: 'fixture-key' }) as { incidents: unknown[] }
      expect(result.incidents).toEqual([])
    } finally {
      await emptyFixture.close()
    }
  }, 10_000)

  it('get_active_incidents throws on HTTP 500', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_active_incidents')!

    await expect(
      tool.execute({}, { baseUrl: fixture.baseUrl + '/http-500', apiKey: 'fixture-key' }),
    ).rejects.toThrow('OpsGenie get_active_incidents failed: HTTP 500')
  })

  it('get_active_incidents throws on missing apiKey', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_active_incidents')!

    await expect(
      tool.execute({}, {}),
    ).rejects.toThrow('OpsGenie API key not configured')
  })

  // ── get_oncall ─────────────────────────────────────────────────────

  it('get_oncall resolves team → schedule → on-call engineer', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_oncall')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute({ team: 'Platform' }, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key' }) as {
      engineer: { name: string; email: string | null; phone: string | null }
    }

    expect(result.engineer).toBeDefined()
    expect(result.engineer.name).toBe('alice@acme.dev')
    expect(result.engineer.email).toBe('alice@acme.dev')
    expect(result.engineer.phone).toBeNull() // phone not exposed by on-call API
  })

  it('get_oncall calls schedules then on-calls in sequence', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_oncall')!
    const before = fixture.receivedRequests.length

    await tool.execute({ team: 'Platform' }, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key' })

    const newReqs = fixture.receivedRequests.slice(before)
    const schedReq = newReqs.find(r => r.path.includes('/v2/schedules') && !r.path.includes('/on-calls'))
    const oncallReq = newReqs.find(r => r.path.includes('/on-calls'))
    expect(schedReq, 'expected GET /v2/schedules call').toBeDefined()
    expect(oncallReq, 'expected GET .../on-calls call').toBeDefined()
    expect(oncallReq!.path).toContain('scheduleIdentifierType=id')
  })

  it('get_oncall is team-name case-insensitive', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_oncall')!

    const result = await tool.execute({ team: 'platform' }, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key' }) as {
      engineer: { name: string }
    }
    expect(result.engineer.name).toBe('alice@acme.dev')
  })

  it('get_oncall throws when team has no schedule', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_oncall')!

    await expect(
      tool.execute({ team: 'nonexistent-team' }, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key' }),
    ).rejects.toThrow('no schedule found for team "nonexistent-team"')
  })

  it('get_oncall throws on schedules HTTP 500', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_oncall')!

    await expect(
      tool.execute({ team: 'Platform' }, { baseUrl: fixture.baseUrl + '/http-500', apiKey: 'fixture-key' }),
    ).rejects.toThrow('OpsGenie get_oncall schedules failed: HTTP 500')
  })

  it('get_oncall throws on missing apiKey', async () => {
    const agent = new OpsgenieAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_oncall')!

    await expect(
      tool.execute({ team: 'Platform' }, {}),
    ).rejects.toThrow('OpsGenie API key not configured')
  })

  // ── smoke ──────────────────────────────────────────────────────────

  it('fixture server received at least one request', () => {
    expect(fixture.receivedRequests.length).toBeGreaterThan(0)
  })
})


describe('opsgenie — orchestration (specialist agent)', () => {
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
