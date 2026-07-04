import { describe, it, expect } from 'vitest'
import { AwsHealthAgent } from './agent.js'
import { AwsHealthBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('aws-health conformance', () => {
  it('agent exposes tools', () => {
    const agent = new AwsHealthAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('aws-health')
  })

  it.skip('bootstrap requires real AWS credentials (CLI-based, see aws-health.integration.test.ts for mocked tests)', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new AwsHealthBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })
})
