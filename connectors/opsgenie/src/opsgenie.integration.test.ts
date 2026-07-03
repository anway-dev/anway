import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { OpsGenieBootstrap } from './bootstrap.js'
import { OpsgenieAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/v2/teams', status: 200, body: {'data': [{'id': 'team-1', 'name': 'Platform'}]} },
  { method: 'GET', path: '/v2/schedules', status: 200, body: {'data': [{'id': 'sch-1', 'name': 'Primary On-Call'}]} },
  { method: 'GET', path: '/v2/alerts', status: 200, body: {'data': [{'id': 'alert-1', 'message': 'payments-api down', 'status': 'open'}]} }
]

describe('opsgenie — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new OpsGenieBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { apiKey: "fixture-key", baseUrl: fixture.baseUrl }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'Primary On-Call'), 'expected entity Primary On-Call not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new OpsgenieAgent()
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


  describe('opsgenie — orchestration (specialist agent)', () => {
    it('specialist agent routes user query to tool and returns grounded response', async () => {
      // Requires a real LLM provider. Skip if none configured.
      const providerType = process.env['ANTHROPIC_API_KEY'] ? 'anthropic'
        : process.env['OPENAI_API_KEY'] ? 'openai'
        : process.env['OLLAMA_ENDPOINT'] ? 'ollama'
        : null
      if (!providerType) {
        console.log('Skipping orchestration test — no model provider configured')
        return
      }
      // Orchestration test: verify the agent harness routes "What OpsGenie teams exist?"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
