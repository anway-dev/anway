import { describe, it, expect } from 'vitest'
import { AzureMonitorAgent } from './agent.js'
import { AzureMonitorBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('azure-monitor conformance', () => {
  it('agent exposes tools', () => {
    const agent = new AzureMonitorAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('azure-monitor')
  })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new AzureMonitorBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', { resourceGroups: ['test-rg'] }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })

  it('bootstrap with empty payload still succeeds', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new AzureMonitorBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
  })
})
