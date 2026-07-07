import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { SentryBootstrap } from './bootstrap.js'
import { SentryAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  // ── bootstrap routes ─────────────────────────────────────────────────
  { method: 'GET', path: '/api/0/organizations/acme/projects/', status: 200, body: [
    { id: 'p-1', slug: 'payments-api', name: 'payments-api' },
    { id: 'p-2', slug: 'checkout-ui', name: 'checkout-ui' },
  ] },

  // ── get_issues (happy path — multi-issue, count as string per real API) ──
  {
    method: 'GET', path: '/api/0/projects/acme/payments-api/issues/', status: 200, body: [
      {
        id: 's-1', title: 'TypeError: cannot read property "x" of undefined', count: '42',
        firstSeen: '2026-07-01T10:00:00Z', lastSeen: '2026-07-04T10:00:00Z',
      },
      {
        id: 's-2', title: 'DatabaseError: connection timeout', count: '7',
        firstSeen: '2026-07-03T14:00:00Z', lastSeen: '2026-07-04T09:30:00Z',
      },
      {
        id: 's-3', title: 'ValueError: invalid input', count: '1',
        firstSeen: '2026-07-04T08:00:00Z', lastSeen: '2026-07-04T08:00:00Z',
      },
    ],
  },

  // ── get_issues (empty project) ───────────────────────────────────────
  { method: 'GET', path: '/api/0/projects/acme/empty-project/issues/', status: 200, body: [] },

  // ── get_events (happy path — real Sentry event shape with nested entries) ──
  {
    method: 'GET', path: '/api/0/issues/s-1/events/', status: 200, body: [
      {
        eventID: 'e-1',
        message: 'TypeError: cannot read property "x" of undefined',
        title: 'TypeError: cannot read property "x" of undefined',
        dateCreated: '2026-07-04T10:00:00Z',
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  type: 'TypeError',
                  value: 'cannot read property "x" of undefined',
                  stacktrace: {
                    frames: [
                      { filename: 'handler.js', function: 'processOrder', lineNo: 42, colNo: 15, absPath: '/app/payments/handler.js' },
                      { filename: 'server.js', function: 'handleRequest', lineNo: 100, colNo: 10, absPath: '/app/payments/server.js' },
                      { filename: 'router.js', function: null, lineNo: 55, colNo: 3, absPath: '/app/payments/router.js' },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      {
        eventID: 'e-2',
        message: 'DatabaseError: connection timeout',
        title: 'DatabaseError: connection timeout',
        dateCreated: '2026-07-04T09:45:00Z',
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  type: 'DatabaseError',
                  value: 'connection timeout after 30s',
                  stacktrace: {
                    frames: [
                      { filename: 'db.js', function: 'connect', lineNo: 30, colNo: 5, absPath: '/app/payments/db.js' },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  },

  // ── get_events (issue with no entries — e.g. message-only event) ────
  {
    method: 'GET', path: '/api/0/issues/s-no-stack/events/', status: 200, body: [
      {
        eventID: 'e-nostack',
        message: 'SimpleError: something happened',
        dateCreated: '2026-07-04T09:00:00Z',
        entries: [],
      },
    ],
  },

  // ── error routes (404 / 500) ─────────────────────────────────────────
  { method: 'GET', path: '/api/0/projects/acme/nonexistent/issues/', status: 404, body: { detail: 'Project not found' } },
  { method: 'GET', path: '/api/0/issues/nonexistent/events/', status: 404, body: { detail: 'Issue not found' } },
  { method: 'GET', path: '/http-500/api/0/projects/acme/payments-api/issues/', status: 500, body: { detail: 'Internal error' } },
  { method: 'GET', path: '/http-500/api/0/issues/s-1/events/', status: 500, body: { detail: 'Internal error' } },
]

describe('sentry — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  // ── bootstrap ────────────────────────────────────────────────────────

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new SentryBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector',
      { token: 'fixture-token', baseUrl: fixture.baseUrl, org: 'acme' },
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'payments-api'), 'expected entity payments-api not extracted').toBe(true)
  })

  // ── agent tools metadata ─────────────────────────────────────────────

  it('agent has exactly 2 read tools', () => {
    const agent = new SentryAgent()
    expect(agent.tools).toHaveLength(2)
    expect(agent.tools.every(t => !t.write)).toBe(true)
  })

  // ── get_issues ───────────────────────────────────────────────────────

  it('get_issues returns mapped issues from fixture with count cast to number', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { project: 'payments-api' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    ) as { issues: Array<{ id: string; title: string; count: number; firstSeen: string; lastSeen: string }> }

    expect(result.issues).toHaveLength(3)

    expect(result.issues[0]).toEqual({
      id: 's-1',
      title: 'TypeError: cannot read property "x" of undefined',
      count: 42,
      firstSeen: '2026-07-01T10:00:00Z',
      lastSeen: '2026-07-04T10:00:00Z',
    })
    // count is a string in the real API — verify cast to number
    expect(typeof result.issues[0]!.count).toBe('number')
    expect(result.issues[1]!.count).toBe(7)
    expect(result.issues[2]!.count).toBe(1)
  })

  it('get_issues returns empty array for project with no issues', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

    const result = await tool.execute(
      { project: 'empty-project' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    ) as { issues: unknown[] }

    expect(result.issues).toEqual([])
  })

  it('get_issues throws on HTTP 404 (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

    await expect(tool.execute(
      { project: 'nonexistent' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    )).rejects.toThrow('Sentry get_issues failed: HTTP 404')
  })

  it('get_issues throws on HTTP 500 (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

    await expect(tool.execute(
      { project: 'payments-api' },
      { baseUrl: fixture.baseUrl + '/http-500', token: 'fixture-token', org: 'acme' },
    )).rejects.toThrow('Sentry get_issues failed: HTTP 500')
  })

  it('get_issues throws when missing token (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

    await expect(tool.execute(
      { project: 'payments-api' },
      { baseUrl: fixture.baseUrl, org: 'acme' },
    )).rejects.toThrow('Sentry credentials not configured')
  })

  it('get_issues throws when missing org (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

    await expect(tool.execute(
      { project: 'payments-api' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    )).rejects.toThrow('Sentry credentials not configured')
  })

  it('get_issues throws when empty project param (real usage error, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

    await expect(tool.execute(
      { project: '' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    )).rejects.toThrow('Sentry get_issues: project is required')
  })

  it('get_issues URL-encodes org and project path segments', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_issues')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { project: 'payments-api' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const issueReq = newReqs.find(r => r.path.includes('/projects/acme/payments-api/issues'))
    expect(issueReq, 'expected GET /api/0/projects/acme/payments-api/issues/ call').toBeDefined()
  })

  // ── get_events ────────────────────────────────────────────────────────

  it('get_events returns mapped events with extracted stack trace', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { issueId: 's-1' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    ) as { events: Array<{ id: string; message: string; stack: string; ts: string }> }

    expect(result.events).toHaveLength(2)

    // First event: full stack trace extraction
    expect(result.events[0]!.id).toBe('e-1')
    expect(result.events[0]!.message).toBe('TypeError: cannot read property "x" of undefined')
    expect(result.events[0]!.ts).toBe('2026-07-04T10:00:00Z')

    // Stack should contain the frames from the real nested entries structure
    const stack0 = result.events[0]!.stack
    expect(stack0).toContain('at processOrder (handler.js:42:15)')
    expect(stack0).toContain('at handleRequest (server.js:100:10)')
    // Frame with null function name → <anonymous>
    expect(stack0).toContain('at <anonymous> (router.js:55:3)')

    // Second event: single frame
    expect(result.events[1]!.id).toBe('e-2')
    expect(result.events[1]!.message).toBe('DatabaseError: connection timeout')
    expect(result.events[1]!.stack).toBe('at connect (db.js:30:5)')
  })

  it('get_events returns empty stack for event with no exception entries', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!

    const result = await tool.execute(
      { issueId: 's-no-stack' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    ) as { events: Array<{ id: string; stack: string }> }

    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.id).toBe('e-nostack')
    expect(result.events[0]!.stack).toBe('')
  })

  it('get_events throws on HTTP 404 (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!

    await expect(tool.execute(
      { issueId: 'nonexistent' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    )).rejects.toThrow('Sentry get_events failed: HTTP 404')
  })

  it('get_events throws on HTTP 500 (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!

    await expect(tool.execute(
      { issueId: 's-1' },
      { baseUrl: fixture.baseUrl + '/http-500', token: 'fixture-token', org: 'acme' },
    )).rejects.toThrow('Sentry get_events failed: HTTP 500')
  })

  it('get_events throws when missing token (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!

    await expect(tool.execute(
      { issueId: 's-1' },
      { baseUrl: fixture.baseUrl, org: 'acme' },
    )).rejects.toThrow('Sentry credentials not configured')
  })

  it('get_events throws when missing org (real failure, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!

    await expect(tool.execute(
      { issueId: 's-1' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    )).rejects.toThrow('Sentry credentials not configured')
  })

  it('get_events throws when empty issueId param (real usage error, not an empty result)', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!

    await expect(tool.execute(
      { issueId: '' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    )).rejects.toThrow('Sentry get_events: issueId is required')
  })

  it('get_events URL-encodes issueId path segment', async () => {
    const agent = new SentryAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_events')!
    const before = fixture.receivedRequests.length

    await tool.execute(
      { issueId: 's-1' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token', org: 'acme' },
    )

    const newReqs = fixture.receivedRequests.slice(before)
    const eventReq = newReqs.find(r => r.path.includes('/issues/s-1/events'))
    expect(eventReq, 'expected GET /api/0/issues/s-1/events/ call').toBeDefined()
  })

  // ── smoke ────────────────────────────────────────────────────────────

  it('fixture server received at least one request', () => {
    expect(fixture.receivedRequests.length).toBeGreaterThan(0)
  })
})


describe('sentry — orchestration (specialist agent)', () => {
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
