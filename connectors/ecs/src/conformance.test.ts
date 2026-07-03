import { describe, it, expect } from 'vitest'
import { EcsAgent } from './agent.js'
import { EcsBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('ecs conformance', () => {
  it('agent exposes tools', () => {
    const agent = new EcsAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('ecs')
  })

  it('agent tools have valid definitions', () => {
    const agent = new EcsAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new EcsBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', { cluster: 'test', services: ['test-svc'] }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })
})
