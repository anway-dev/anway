import { describe, it, expect } from 'vitest'
import { KubernetesBootstrap } from './bootstrap.js'
import { K8sAgent } from './agent.js'


const token = process.env['KUBECONFIG']
const skip = !token

describe.skipIf(skip)('k8s — integration (real API)', () => {
  it('bootstrap finds entities', async () => {
    const kg = new FakeKG()
    const result = await new KubernetesBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test',
      { apiKey: token! }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
  })

  it('agent tools are callable', async () => {
    const agent = new K8sAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
  })
})
