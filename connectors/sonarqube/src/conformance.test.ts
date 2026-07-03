import { describe, it, expect } from 'vitest'
import { SonarqubeAgent } from './agent.js'
import { SonarQubeBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('sonarqube conformance', () => {
  it('agent exposes tools', () => {
    const agent = new SonarqubeAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('sonarqube')
  })

  it('agent tools have valid definitions', () => {
    const agent = new SonarqubeAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  it('bootstrap returns valid result structure', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new SonarQubeBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
    expect(result.episodeHints).toBeDefined()
  })
})
