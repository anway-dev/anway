import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent'
import type { FixtureRoute, FixtureServer } from '@anway/agent'
import { DatadogBootstrap } from './bootstrap.js'
import { DatadogAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/api/v1/monitor', status: 200, body: [{'id': 1, 'name': 'High Error Rate', 'type': 'metric alert', 'tags': ['service:payments-api']}] },
  { method: 'GET', path: '/api/v1/dashboard', status: 200, body: {'dashboards': [{'id': 'abc-123', 'title': 'Payments Dashboard'}]} },
  { method: 'GET', path: '/api/v1/query', status: 200, body: {'series': [{'metric': 'aws.ec2.cpuutilization', 'pointlist': [[1700000000, 42.5]]}]} }
]

describe('datadog — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new DatadogBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { apiKey: "fixture-key", appKey: "fixture-app-key", baseUrl: fixture.baseUrl }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'High Error Rate'), 'expected entity High Error Rate not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new DatadogAgent()
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
