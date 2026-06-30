import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent'
import type { FixtureRoute, FixtureServer } from '@anway/agent'
import { DynatraceBootstrap } from './bootstrap.js'
import { DynatraceAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/api/v2/entities', status: 200, body: {'entities': [{'entityId': 'SERVICE-1', 'displayName': 'payments-api', 'type': 'SERVICE'}]} },
  { method: 'GET', path: '/api/v2/metrics/query', status: 200, body: {'resolution': '1m', 'result': [{'metricId': 'builtin:service.errors.total.rate', 'data': [{'timestamps': [1700000000], 'values': [0.02]}]}]} }
]

describe('dynatrace — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new DynatraceBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { host: fixture.baseUrl, token: "fixture-token" }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'payments-api'), 'expected entity payments-api not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new DynatraceAgent()
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
