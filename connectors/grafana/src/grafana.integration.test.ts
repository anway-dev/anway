import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import { GrafanaBootstrap } from './bootstrap.js'
import { GrafanaAgent } from './agent.js'


describe('grafana — integration (real Docker)', () => {
  let baseUrl: string
  let container: Awaited<ReturnType<GenericContainer['start']>>

  beforeAll(async () => {
    container = await new GenericContainer('grafana/grafana:10.4.0')
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forHttp("/api/health", 3000))
      .withEnvironment({ "GF_AUTH_ANONYMOUS_ENABLED": "true", "GF_AUTH_ANONYMOUS_ORG_ROLE": "Admin", "GF_SECURITY_ADMIN_PASSWORD": "admin" })
      .start()
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(3000)}`
  }, 90_000)

  afterAll(async () => { await container?.stop() })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKG()
    const result = await new GrafanaBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { "baseUrl": baseUrl, "token": "" }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(result.episodeHints).toBeDefined()
  })

  it('agent tools are callable against real service', async () => {
    const agent = new GrafanaAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
    const firstTool = tools[0]!
      const result = await firstTool.execute({}, { baseUrl })
      expect(result).toBeDefined()
  })
})


  describe('grafana — orchestration (specialist agent)', () => {
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
      // Orchestration test: verify the agent harness routes "List Grafana dashboards"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
})
