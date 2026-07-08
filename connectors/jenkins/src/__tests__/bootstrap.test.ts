import { describe, it, expect, vi } from 'vitest'
import type { IKnowledgeGraph } from '@anway/agent'

describe('JenkinsBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.JenkinsBootstrap).toBeDefined()
  })

  // Regression test: bootstrap() previously called upsertRelationship with
  // fabricated `Deploy:${name}` / `Pipeline:${name}` strings instead of the
  // real UUIDs upsertEntity returns. upsertRelationship casts both ids to
  // ::uuid in Postgres, so this crashed on the very first real build.
  it('resolves Deploy DEPLOYED_TO Pipeline using real entity UUIDs, not fabricated Type:name strings', async () => {
    const { JenkinsBootstrap } = await import('../bootstrap.js')

    let nextId = 0
    const relationships: Array<{ fromEntityId: string; relType: string; toEntityId: string }> = []

    const kg = {
      upsertEntity: vi.fn(async () => `uuid-${nextId++}`),
      upsertRelationship: vi.fn(async (rel: { fromEntityId: string; relType: string; toEntityId: string }) => {
        expect(rel.fromEntityId).toMatch(/^uuid-\d+$/)
        expect(rel.toEntityId).toMatch(/^uuid-\d+$/)
        relationships.push(rel)
        return 'rel-id'
      }),
    } as unknown as IKnowledgeGraph

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jobs: [{
          name: 'payments-api-build',
          url: 'https://jenkins.example.com/job/payments-api-build/',
          lastBuild: { number: 42, result: 'SUCCESS', timestamp: Date.now() },
        }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const bootstrap = new JenkinsBootstrap(kg)
    const result = await bootstrap.bootstrap('t-1' as any, 'conn-1', {
      baseUrl: 'https://jenkins.example.com', user: 'ci', apiToken: 'tok',
    })

    expect(result.entitiesUpserted).toBe(2)
    expect(result.relationshipsUpserted).toBe(1)
    expect(relationships).toHaveLength(1)
    expect(relationships[0]!.relType).toBe('DEPLOYED_TO')

    vi.unstubAllGlobals()
  })
})
