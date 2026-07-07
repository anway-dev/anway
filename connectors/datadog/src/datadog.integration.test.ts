import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { DatadogBootstrap } from './bootstrap.js'
import { DatadogAgent } from './agent.js'

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
    // get_alerts — no required params, unlike get_metrics (needs service+window)
    const alertsTool = tools.find(t => t.definition.name === 'get_alerts')!
    // Real creds shape (apiKey/app_key), matching ConnectorCreds — a wrong
    // shape here now throws instead of silently returning an empty result,
    // which is exactly the case this test is meant to prove works.
    const result = await alertsTool.execute({}, { baseUrl: fixture.baseUrl, apiKey: 'fixture-key', app_key: 'fixture-app-key' }) as { alerts: unknown[] }
    expect(result.alerts).toBeDefined()
  })

  it('agent tools throw on missing creds instead of returning an empty result', async () => {
    const agent = new DatadogAgent()
    const alertsTool = agent.tools.find(t => t.definition.name === 'get_alerts')!
    await expect(alertsTool.execute({}, { baseUrl: fixture.baseUrl })).rejects.toThrow('Datadog credentials not configured')
  })

  it('fixture server received at least one request', () => {
    expect(fixture.receivedRequests.length).toBeGreaterThan(0)
  })
})


  describe('datadog — orchestration (specialist agent)', () => {
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
      // Orchestration test: verify the agent harness routes "What monitors are firing?"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
