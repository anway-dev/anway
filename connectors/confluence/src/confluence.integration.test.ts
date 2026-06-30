import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent'
import type { FixtureRoute, FixtureServer } from '@anway/agent'
import { ConfluenceBootstrap } from './bootstrap.js'
import { ConfluenceAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/wiki/rest/api/space', status: 200, body: {'results': [{'key': 'PAY', 'name': 'Payments Team'}]} },
  { method: 'GET', path: '/wiki/rest/api/content', status: 200, body: {'results': [{'id': '123', 'title': 'Runbook: payments-api', 'type': 'page'}]} }
]

describe('confluence — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new ConfluenceBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { host: fixture.baseUrl, email: "test@test.com", token: "fixture-token" }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'Payments Team'), 'expected entity Payments Team not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new ConfluenceAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
    const firstTool = tools[0]!
    const result = await firstTool.execute({}, { baseUrl: fixture.baseUrl, token: 'fixture-token' })
    expect(result).toBeDefined()
  })

  it('fixture server received at least one request', () => {
    expect(fixture.receivedRequests.length).toBeGreaterThan(0)
  })
})
