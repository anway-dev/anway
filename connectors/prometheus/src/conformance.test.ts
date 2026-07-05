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

  it('bootstrap throws explicitly when prometheus is unreachable (no localhost:9090 in CI)', async () => {
    // Unlike most connectors, PrometheusBootstrap deliberately throws rather
    // than silently returning entitiesUpserted: 0 on connection failure — so
    // an outage is never reported as "0 real entities, all fine." The real
    // caller (graph-builder/subscriber.ts) catches this and records
    // bootstrap_failed via audit log; it does not crash. This test asserts
    // that real contract instead of assuming a graceful return that this
    // connector intentionally does not provide.
    const kg = new FakeKnowledgeGraph()
    await expect(
      new PrometheusBootstrap(kg).bootstrap('00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}),
    ).rejects.toThrow(/prometheus unreachable/)
  })
})
