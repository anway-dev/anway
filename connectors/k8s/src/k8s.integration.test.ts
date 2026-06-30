import { describe, it, expect } from 'vitest'
import { KubernetesBootstrap } from './bootstrap.js'
import { K8sAgent } from './agent.js'

class FakeKG {
  readonly entities: Array<{ type: string; name: string; metadata: Record<string, unknown> }> = []
  async upsertEntity(e: { type: string; name: string; metadata: Record<string, unknown> }, _tid: string) { this.entities.push(e); return `${e.type}:${e.name}` }
  async upsertRelationship(_r: { fromEntityId: string; relType: string; toEntityId: string }, _tid: string) { return 'r-1' }
}

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
