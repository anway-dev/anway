import { describe, it, expect } from 'vitest'
import { PrometheusAgent } from './agent.js'
import { PrometheusBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('prometheus conformance', () => {
  it('agent exposes tools', () => {
    const agent = new PrometheusAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('prometheus')
  })

  it('agent tools have valid definitions', () => {
    const agent = new PrometheusAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  it('bootstrap returns valid result structure', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new PrometheusBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
    expect(result.episodeHints).toBeDefined()
  })
})
