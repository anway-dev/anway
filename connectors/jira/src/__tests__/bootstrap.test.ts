import { describe, it, expect, vi } from 'vitest'
import type { IKnowledgeGraph } from '@anway/agent'

describe('JiraBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.JiraBootstrap).toBeDefined()
  })

  // Regression test: bootstrap() previously called upsertRelationship with
  // fabricated `Ticket:${key}` / `Project:${name}` strings instead of the
  // real UUIDs upsertEntity returns. upsertRelationship casts both ids to
  // ::uuid in Postgres, so this crashed on the very first real ticket.
  it('resolves Ticket OWNED_BY Project using real entity UUIDs, not fabricated Type:name strings', async () => {
    const { JiraBootstrap } = await import('../bootstrap.js')

    let nextId = 0
    const upsertedEntities: Array<{ type: string; name: string }> = []
    const relationships: Array<{ fromEntityId: string; relType: string; toEntityId: string }> = []

    const kg = {
      upsertEntity: vi.fn(async (entity: { type: string; name: string }) => {
        const id = `uuid-${nextId++}`
        upsertedEntities.push({ type: entity.type, name: entity.name })
        return id
      }),
      upsertRelationship: vi.fn(async (rel: { fromEntityId: string; relType: string; toEntityId: string }) => {
        // A fabricated "Type:name" string would fail this shape check the
        // same way it fails the real Postgres ::uuid cast.
        expect(rel.fromEntityId).toMatch(/^uuid-\d+$/)
        expect(rel.toEntityId).toMatch(/^uuid-\d+$/)
        relationships.push(rel)
        return 'rel-id'
      }),
    } as unknown as IKnowledgeGraph

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/project/search')) {
        return {
          ok: true,
          json: async () => ({ values: [{ id: 'p1', key: 'ENG', name: 'Engineering' }] }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          issues: [{
            id: 'i1', key: 'ENG-1',
            fields: { summary: 'Fix bug', project: { key: 'ENG', name: 'Engineering' }, assignee: null },
          }],
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const bootstrap = new JiraBootstrap(kg)
    const result = await bootstrap.bootstrap('t-1', 'conn-1', {
      baseUrl: 'https://jira.example.com', email: 'a@b.com', apiToken: 'tok',
    })

    expect(result.entitiesUpserted).toBe(2)
    expect(result.relationshipsUpserted).toBe(1)
    expect(relationships).toHaveLength(1)
    expect(relationships[0]!.relType).toBe('OWNED_BY')

    vi.unstubAllGlobals()
  })
})
