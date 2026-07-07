import { describe, it, expect } from 'vitest'
import { VaultAgent } from './agent.js'
import { VaultBootstrap } from './bootstrap.js'
import { FakeKnowledgeGraph } from '@anway/agent/testing'

describe('vault conformance', () => {
  it('agent exposes tools', () => {
    const agent = new VaultAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('vault')
  })

  it('agent tools have valid definitions', () => {
    const agent = new VaultAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  it('bootstrap returns valid result structure', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new VaultBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
    expect(result.episodeHints).toBeDefined()
    // bootstrap.ts retries up to 5x with a 1s backoff when no real Vault dev
    // server is reachable at the default localhost:8200 (exceeds vitest's
    // default 5000ms test timeout in an environment with no Vault running).
  }, 10_000)
})
