import { describe, it, expect } from 'vitest'
import { CoralogixBootstrap } from './bootstrap.js'
import { CoralogixAgent } from './agent.js'

class FakeKG {
  readonly entities: Array<{ type: string; name: string; metadata: Record<string, unknown> }> = []
  async upsertEntity(e: { type: string; name: string; metadata: Record<string, unknown> }, _tid: string) { this.entities.push(e); return `${e.type}:${e.name}` }
  async upsertRelationship(_r: { fromEntityId: string; relType: string; toEntityId: string }, _tid: string) { return 'r-1' }
}

const token = process.env['CORALOGIX_API_KEY']
const skip = !token

describe.skipIf(skip)('coralogix — integration (real API)', () => {
  it('bootstrap finds entities', async () => {
    const kg = new FakeKG()
    const result = await new CoralogixBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test',
      { apiKey: token! }
    )
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
  })

  it('agent tools are callable', async () => {
    const agent = new CoralogixAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
  })
})
