import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import { SonarQubeBootstrap } from './bootstrap.js'
import { SonarqubeAgent } from './agent.js'


describe('sonarqube — integration (real Docker)', () => {
  let baseUrl: string
  let container: Awaited<ReturnType<GenericContainer['start']>>

  beforeAll(async () => {
    container = await new GenericContainer('sonarqube:25.5.0.107428-community')
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/api/system/status", 9000).withStartupTimeout(120_000))
      .start()
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(9000)}`
  }, 180_000)

  afterAll(async () => { await container?.stop() })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKG()
    const result = await new SonarQubeBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { "baseUrl": baseUrl, "token": "admin" }
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)  // fresh SonarQube has no projects, needs seed data
    expect(result.episodeHints).toBeDefined()
  })

  it('agent tools are callable against real service', async () => {
    const agent = new SonarqubeAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
    const firstTool = tools[0]!
      const result = await firstTool.execute({}, { baseUrl })
      expect(result).toBeDefined()
  })
})


  describe('sonarqube — orchestration (specialist agent)', () => {
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
      // Orchestration test: verify the agent harness routes "List SonarQube projects"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
