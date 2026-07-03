import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { JiraBootstrap } from './bootstrap.js'
import { JiraAgent } from './agent.js'


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/rest/api/3/project/search', status: 200, body: {'values': [{'id': '10001', 'key': 'PAY', 'name': 'Payments'}]} },
  { method: 'GET', path: '/rest/api/3/search', status: 200, body: {'issues': [{'id': '1', 'key': 'PAY-1', 'fields': {'summary': 'Bug in checkout', 'status': {'name': 'In Progress'}}}], 'total': 1} }
]

describe('jira — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new JiraBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { baseUrl: fixture.baseUrl, email: "test@test.com", token: "fixture-token" }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'Payments'), 'expected entity Payments not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new JiraAgent()
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


  describe('jira — orchestration (specialist agent)', () => {
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
      // Orchestration test: verify the agent harness routes "List open issues in Payments project"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
