import { describe, it, expect, vi } from 'vitest'
import type { IKnowledgeGraph } from '@anway/agent'

describe('SentryBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.SentryBootstrap).toBeDefined()
  })

  // Regression test: bootstrap() previously called upsertRelationship with
  // fabricated `Alert:${title}` / `Service:${slug}` strings instead of the
  // real UUIDs upsertEntity returns. upsertRelationship casts both ids to
  // ::uuid in Postgres, so this crashed on the very first real issue.
  it('resolves Alert MONITORED_BY Service using real entity UUIDs, not fabricated Type:name strings', async () => {
    const { SentryBootstrap } = await import('../bootstrap.js')

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

    const fetchMock = vi.fn(async (url: string) => {
      // Both endpoints contain "/projects/" — check the more specific
      // issues path first.
      if (url.includes('/issues/')) {
        return { ok: true, json: async () => [{ id: 'i1', title: 'NullPointerException', culprit: 'checkout()' }] }
      }
      return { ok: true, json: async () => [{ id: 'p1', slug: 'payments-api', name: 'Payments API' }] }
    })
    vi.stubGlobal('fetch', fetchMock)

    const bootstrap = new SentryBootstrap(kg)
    const result = await bootstrap.bootstrap('t-1', 'conn-1', {
      token: 'tok', org: 'acme',
    })

    expect(result.entitiesUpserted).toBe(2)
    expect(result.relationshipsUpserted).toBe(1)
    expect(relationships).toHaveLength(1)
    expect(relationships[0]!.relType).toBe('MONITORED_BY')

    vi.unstubAllGlobals()
  })
})
