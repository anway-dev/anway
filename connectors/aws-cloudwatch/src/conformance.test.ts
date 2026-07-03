import { describe, it, expect } from 'vitest'
import { AwsCloudwatchAgent } from './agent.js'
import { AwsCloudwatchBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('aws-cloudwatch conformance', () => {
  it('agent exposes tools', () => {
    const agent = new AwsCloudwatchAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('aws-cloudwatch')
  })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new AwsCloudwatchBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })
})
