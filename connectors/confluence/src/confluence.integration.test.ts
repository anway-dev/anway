import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { ConfluenceBootstrap } from './bootstrap.js'
import { ConfluenceAgent } from './agent.js'

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
 * behavior (missing creds, non-OK HTTP, etc.) exercised in this file. A stronger real-API-contract check exists in the sibling
 * confluence.prism.test.ts (validates requests against the real published
 * OpenAPI/AsyncAPI spec via Prism, not a self-authored fixture).
 */


const searchFixture = {
  results: [
    {
      id: 'p-100',
      title: 'Runbook: payments-api',
      type: 'page',
      _links: { webui: '/wiki/spaces/PAY/pages/100/Runbook-payments-api' },
      version: { when: '2026-07-01T14:30:00.000Z' },
    },
    {
      id: 'p-101',
      title: 'Architecture Overview',
      type: 'page',
      _links: { webui: '/wiki/spaces/ENG/pages/101/Architecture-Overview' },
      version: { when: '2026-06-28T09:15:00.000Z' },
    },
    {
      id: 'p-102',
      title: 'Incident Post-Mortem: checkout-outage',
      type: 'page',
      _links: { webui: '/wiki/spaces/SRE/pages/102/Incident-Post-Mortem' },
      version: { when: '2026-07-03T22:00:00.000Z' },
    },
  ],
  _links: { base: 'https://test.atlassian.net/wiki' },
}

const emptySearchFixture = {
  results: [],
  _links: { base: 'https://test.atlassian.net/wiki' },
}

const fixtureRoutes: FixtureRoute[] = [
  {
    method: 'GET',
    path: '/wiki/rest/api/space',
    status: 200,
    body: { results: [{ key: 'PAY', name: 'Payments Team' }] },
  },
  {
    method: 'GET',
    path: '/wiki/rest/api/space/PAY/content',
    status: 200,
    body: { results: [{ id: '123', title: 'Runbook: payments-api', type: 'page' }] },
  },
  {
    method: 'GET',
    path: '/wiki/rest/api/content/search',
    status: 200,
    body: searchFixture,
  },
]

describe('confluence — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  // ── bootstrap ──────────────────────────────────────────────────────

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new ConfluenceBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector',
      { baseUrl: fixture.baseUrl, email: 'test@test.com', apiToken: 'fixture-token' },
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'Runbook: payments-api'), 'expected doc not extracted').toBe(true)
  })

  // ── search_pages — happy path ──────────────────────────────────────

  it('search_pages returns real parsed data from fixture', async () => {
    const agent = new ConfluenceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'search_pages')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { query: 'payments' },
      { baseUrl: fixture.baseUrl, email: 'test@test.com', apiToken: 'fixture-token' },
    ) as { pages: Array<{ id: string; title: string; url: string; updatedAt: string }> }

    expect(result.pages).toHaveLength(3)

    // First result: Runbook page
    expect(result.pages[0]!.id).toBe('p-100')
    expect(result.pages[0]!.title).toBe('Runbook: payments-api')
    expect(result.pages[0]!.url).toContain('/wiki/spaces/PAY/pages/100/Runbook-payments-api')
    expect(result.pages[0]!.updatedAt).toBe('2026-07-01T14:30:00.000Z')

    // Second result: Architecture page
    expect(result.pages[1]!.id).toBe('p-101')
    expect(result.pages[1]!.title).toBe('Architecture Overview')
    expect(result.pages[1]!.url).toContain('/wiki/spaces/ENG/pages/101/Architecture-Overview')

    // Third result: Incident post-mortem
    expect(result.pages[2]!.id).toBe('p-102')
    expect(result.pages[2]!.title).toBe('Incident Post-Mortem: checkout-outage')
    expect(result.pages[2]!.updatedAt).toBe('2026-07-03T22:00:00.000Z')
  })

  it('search_pages URL includes CQL-encoded query', async () => {
    const agent = new ConfluenceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'search_pages')!

    await tool.execute(
      { query: 'checkout' },
      { baseUrl: fixture.baseUrl, email: 'test@test.com', apiToken: 'fixture-token' },
    )

    const searchReqs = fixture.receivedRequests.filter(r => r.path.includes('/wiki/rest/api/content/search'))
    expect(searchReqs.length).toBeGreaterThan(0)
    const cqlReq = searchReqs.find(r => r.path.includes('cql='))
    expect(cqlReq, 'expected CQL query param in search URL').toBeDefined()
    expect(cqlReq!.path).toContain('text~')
  })

  // ── search_pages — error path / empty on failure ───────────────────

  it('search_pages throws on missing creds (real failure, not an empty result)', async () => {
    const agent = new ConfluenceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'search_pages')!

    await expect(tool.execute({ query: 'payments' }, {})).rejects.toThrow('Confluence credentials not configured')
  })

  it('search_pages throws when query is blank (real usage error, not an empty result)', async () => {
    const agent = new ConfluenceAgent()
    const tool = agent.tools.find(t => t.definition.name === 'search_pages')!

    await expect(tool.execute(
      { query: '   ' },
      { baseUrl: fixture.baseUrl, email: 'test@test.com', apiToken: 'fixture-token' },
    )).rejects.toThrow('Confluence search_pages: query is required')
  })

  // ── fixture server audit ───────────────────────────────────────────

  it('fixture server received bootstrap + search requests', () => {
    const paths = fixture.receivedRequests.map(r => r.path.split('?')[0]!)
    expect(paths.some(p => p === '/wiki/rest/api/space'), 'expected /wiki/rest/api/space call').toBe(true)
    expect(paths.some(p => p.includes('/wiki/rest/api/space/PAY/content')), 'expected /wiki/rest/api/space/PAY/content call').toBe(true)
    expect(paths.some(p => p === '/wiki/rest/api/content/search'), 'expected /wiki/rest/api/content/search call').toBe(true)
  })
})
