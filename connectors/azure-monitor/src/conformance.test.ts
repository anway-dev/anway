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

  it.skip('bootstrap requires real az CLI auth (CLI-based, see azure-monitor.integration.test.ts for mocked tests)', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new AzureMonitorBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', { resourceGroups: ['test-rg'] }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })

  // 30s timeout: on machines where the az CLI IS installed but not logged
  // in (GitHub Actions runners preinstall it), `az` takes >5s to fail auth —
  // confirmed on real Actions run 29080975927 where the default 5s timeout
  // failed this test while it passes instantly where az is absent.
  it('bootstrap with empty payload does not throw (no az CLI auth available)', async () => {
    const kg = new FakeKnowledgeGraph()
    const result = await new AzureMonitorBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-conn', {}
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
  }, 30_000)
})
