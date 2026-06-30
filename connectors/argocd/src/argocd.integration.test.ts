import { describe, it, expect } from 'vitest'
import { ArgocdBootstrap } from './bootstrap.js'
import { ArgocdAgent } from './agent.js'


const token = process.env['ARGOCD_TOKEN']
const skip = !token

describe.skipIf(skip)('argocd — integration (real API)', () => {
  it('bootstrap finds entities', async () => {
    const kg = new FakeKG()
    const result = await new ArgocdBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test',
      { apiKey: token! }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })

  it('agent tools are callable', async () => {
    const agent = new ArgocdAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
  })
})
