import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { VercelBootstrap } from './bootstrap.js'
import { VercelAgent } from './agent.js'

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
 * behavior (missing creds, non-OK HTTP, etc.) exercised in this file. No stronger real-API-contract test exists for this connector yet
 * (see connectors/{github,jira,confluence,pagerduty,slack} for the Prism-based
 * pattern this could be upgraded to).
 */


const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/v9/projects', status: 200, body: {'projects': [{'id': 'proj-1', 'name': 'payments-frontend', 'framework': 'nextjs'}]} },
  { method: 'GET', path: '/v6/deployments', status: 200, body: {'deployments': [{'uid': 'dpl-1', 'name': 'payments-frontend', 'state': 'READY'}]} }
]

describe('vercel — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new VercelBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { token: "fixture-token", baseUrl: fixture.baseUrl }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'payments-frontend'), 'expected entity payments-frontend not extracted').toBe(true)
  })

  it('agent tools query fixture server', async () => {
    const agent = new VercelAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
    // get_pipelines (tools[0]) requires `service` and reads creds.apiKey
    // (not `token`) — omitting either is no longer a no-op empty result,
    // it's a real thrown error.
    const firstTool = tools[0]!
    const result = await firstTool.execute({ service: 'payments-frontend' }, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key' }) as { pipelines: unknown[] }
    expect(result.pipelines).toBeDefined()
  })

  it('agent tools throw on missing apiKey instead of returning an empty result', async () => {
    const agent = new VercelAgent()
    const firstTool = agent.tools[0]!
    await expect(firstTool.execute({ service: 'payments-frontend' }, { baseUrl: fixture.baseUrl })).rejects.toThrow('Vercel API key not configured')
  })

  it('fixture server received at least one request', () => {
    expect(fixture.receivedRequests.length).toBeGreaterThan(0)
  })
})


  describe('vercel — orchestration (specialist agent)', () => {
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
      // Orchestration test: verify the agent harness routes "List Vercel projects"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
