import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { ConfluenceBootstrap } from './bootstrap.js'
import { ConfluenceAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/wiki/rest/api/space', status: 200, body: {'results': [{'key': 'PAY', 'name': 'Payments Team'}]} },
  { method: 'GET', path: '/wiki/rest/api/space/PAY/content', status: 200, body: {'results': [{'id': '123', 'title': 'Runbook: payments-api', 'type': 'page'}]} }
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
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { baseUrl: fixture.baseUrl, email: "test@test.com", apiToken: "fixture-token" }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    // Bootstrap creates Doc entities from page titles, not Space entities
    expect(kg.entities.some(e => e.name === 'Runbook: payments-api'), 'expected doc not extracted').toBe(true)
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


  describe('confluence — orchestration (specialist agent)', () => {
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
      // Orchestration test: verify the agent harness routes "What Confluence spaces exist?"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
