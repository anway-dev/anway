import { describe, it, expect } from 'vitest'
import { ElasticAgent } from './agent.js'
import { ElasticsearchBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('elastic conformance', () => {
  it('agent exposes tools', () => {
    const agent = new ElasticAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('elastic')
  })

  it('agent tools have valid definitions', () => {
    const agent = new ElasticAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  it('bootstrap returns valid result structure', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new ElasticsearchBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
    expect(result.episodeHints).toBeDefined()
  })
})
