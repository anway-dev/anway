import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent'
import type { FixtureRoute, FixtureServer } from '@anway/agent'
import { LaunchDarklyBootstrap } from './bootstrap.js'
import { LaunchdarklyAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/api/v2/projects', status: 200, body: {'items': [{'key': 'payments', 'name': 'Payments', 'environments': {'production': {'key': 'production'}}}]} },
  { method: 'GET', path: '/api/v2/flags/payments', status: 200, body: {'items': [{'key': 'new-checkout-flow', 'name': 'New Checkout Flow', 'on': true}]} }
]

describe('launchdarkly — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new LaunchDarklyBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { sdkKey: "fixture-key", baseUrl: fixture.baseUrl }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'Payments'), 'expected entity Payments not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new LaunchdarklyAgent()
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
