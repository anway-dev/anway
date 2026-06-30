import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent'
import { PrometheusBootstrap } from './bootstrap.js'
import { PrometheusAgent } from './agent.js'

// In-memory fake KG for integration tests

describe('prometheus — integration (real Docker)', () => {
  let baseUrl: string
  let container: Awaited<ReturnType<GenericContainer['start']>>

  beforeAll(async () => {
    container = await new GenericContainer('prom/prometheus:v2.51.0')
      .withExposedPorts(9090)
      .withWaitStrategy(Wait.forHttp('/-/ready', 9090))
      .start()
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(9090)}`
  }, 90_000)

  afterAll(async () => { await container?.stop() })

  it('bootstrap extracts ≥0 entities (fresh prometheus, no scrape targets)', async () => {
    const kg = new FakeKG()
    const result = await new PrometheusBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { baseUrl }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(result.episodeHints).toBeDefined()
  })

  it('agent query_metrics returns valid PromQL response', async () => {
    const agent = new PrometheusAgent()
    const tools = agent.tools
    const queryTool = tools.find(t => t.definition.name === 'prometheus__query')!
    const result = await queryTool.execute({ query: 'up' }, { baseUrl })
    expect(result).toBeDefined()
  })

  it('agent get_alerts returns array', async () => {
    const agent = new PrometheusAgent()
    const tools = agent.tools
    const alertsTool = tools.find(t => t.definition.name === 'prometheus__alerts')!
    const result = await alertsTool.execute({}, { baseUrl })
    expect(result).toHaveProperty('alerts')
    expect(Array.isArray((result as any).alerts)).toBe(true)
  })
})
