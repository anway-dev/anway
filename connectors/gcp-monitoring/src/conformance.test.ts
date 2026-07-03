import { describe, it, expect } from 'vitest'
import { GcpMonitoringAgent } from './agent.js'
import { GcpMonitoringBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('gcp-monitoring conformance', () => {
  it('agent exposes tools', () => {
    const agent = new GcpMonitoringAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('gcp-monitoring')
  })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', { projects: ['test-project'] }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })
})
