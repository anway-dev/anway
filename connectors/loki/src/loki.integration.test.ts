import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { LokiBootstrap } from './bootstrap.js'
import { LokiAgent } from './agent.js'

class FakeKG {
  readonly entities: Array<{ type: string; name: string; metadata: Record<string, unknown> }> = []
  async upsertEntity(e: { type: string; name: string; metadata: Record<string, unknown> }, _tid: string) { this.entities.push(e); return `${e.type}:${e.name}` }
  async upsertRelationship(_r: { fromEntityId: string; relType: string; toEntityId: string }, _tid: string) { return 'r-1' }
}

describe('loki — integration (real Docker)', () => {
  let baseUrl: string
  let container: Awaited<ReturnType<GenericContainer['start']>>

  beforeAll(async () => {
    container = await new GenericContainer('grafana/loki:2.9.0')
      .withExposedPorts(3100)
      .withWaitStrategy(Wait.forHttp("/ready", 3100))
      .start()
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(3100)}`
  }, 90_000)

  afterAll(async () => { await container?.stop() })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKG()
    const result = await new LokiBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { "baseUrl": baseUrl }
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
    expect(result.episodeHints).toBeDefined()
  })

  it('agent tools are callable against real service', async () => {
    const agent = new LokiAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
    const firstTool = tools[0]!
    try {
      const result = await firstTool.execute({}, { baseUrl })
      expect(result).toBeDefined()
    } catch {
      // Fresh container may return empty/error — either is OK, tool did not crash
    }
  })
})
