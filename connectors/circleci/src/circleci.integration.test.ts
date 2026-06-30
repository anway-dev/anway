import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent'
import type { FixtureRoute, FixtureServer } from '@anway/agent'
import { CircleCIBootstrap } from './bootstrap.js'
import { CircleciAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/api/v2/me', status: 200, body: {'login': 'test-user', 'id': 'user-1'} },
  { method: 'GET', path: '/api/v2/pipeline', status: 200, body: {'items': [{'id': 'pipe-1', 'project_slug': 'gh/acme/payments', 'state': 'created'}]} }
]

describe('circleci — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new CircleCIBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { token: "fixture-token", baseUrl: fixture.baseUrl }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'payments'), 'expected entity payments not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new CircleciAgent()
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
