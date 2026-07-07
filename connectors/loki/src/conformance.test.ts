import { describe, it, expect } from 'vitest'
import { LokiAgent } from './agent.js'
import { LokiBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('loki conformance', () => {
  it('agent exposes tools', () => {
    const agent = new LokiAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('loki')
  })

  it('agent tools have valid definitions', () => {
    const agent = new LokiAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  it('bootstrap returns valid result structure', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new LokiBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
    expect(result.episodeHints).toBeDefined()
    // No baseUrl in payload — bootstrap.ts falls back to a real network call
    // against http://localhost:3100 (its documented default), not a fixture.
    // Same real-I/O-under-load class as the other loki tests: confirmed
    // live failing under `pnpm test`'s full monorepo parallel load with
    // vitest's default 5000ms, passing clean in isolation.
  }, 15_000)
})
