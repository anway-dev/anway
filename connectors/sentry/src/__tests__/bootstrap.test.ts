import { describe, it, expect, vi, beforeEach } from 'vitest'

const tenantId = '00000000-0000-0000-0000-000000000001' as any

beforeEach(() => {
  vi.unstubAllGlobals()
})

// Fetch mock helper — sentry's project list now paginates via the real Link
// response header, so the mock must expose headers.get('link') too.
function mockSentry(routes: (url: string) => { body: unknown; link?: string }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const { body, link } = routes(url)
    return {
      ok: true,
      json: async () => body,
      headers: { get: (name: string) => (name.toLowerCase() === 'link' ? link ?? null : null) },
    }
  }))
}

describe('SentryBootstrap', () => {
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
    } as any

    mockSentry((url) => {
      if (url.includes('/issues/')) return { body: [{ id: 'i1', title: 'NullPointerException', culprit: 'checkout()' }] }
      return { body: [{ id: 'p1', slug: 'payments-api', name: 'Payments API' }] }
    })

    const result = await new SentryBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'tok', org: 'acme' })

    expect(result.entitiesUpserted).toBe(2)
    expect(result.relationshipsUpserted).toBe(1)
    expect(relationships[0]!.relType).toBe('MONITORED_BY')
  })

  // Regression test: previously indexed recent issues for the FIRST project
  // ONLY — every other project's errors were silently absent from the graph.
  it('indexes recent issues for every project, not just the first', async () => {
    const { SentryBootstrap } = await import('../bootstrap.js')
    let nextId = 0
    const kg = {
      upsertEntity: vi.fn(async () => `uuid-${nextId++}`),
      upsertRelationship: vi.fn(async () => 'rel-id'),
    } as any

    mockSentry((url) => {
      if (url.includes('/payments-api/issues/')) return { body: [{ id: 'i1', title: 'ErrA' }] }
      if (url.includes('/checkout-api/issues/')) return { body: [{ id: 'i2', title: 'ErrB' }] }
      return { body: [
        { id: 'p1', slug: 'payments-api', name: 'Payments' },
        { id: 'p2', slug: 'checkout-api', name: 'Checkout' },
      ] }
    })

    const result = await new SentryBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'tok', org: 'acme' })
    // 2 projects + 2 issues (one per project)
    expect(result.entitiesUpserted).toBe(4)
    expect(result.relationshipsUpserted).toBe(2)
  })

  // Regression test: project list previously fetched one unpaginated page —
  // now follows Sentry's real Link-header cursor pagination.
  it('follows Link-header pagination across project pages', async () => {
    const { SentryBootstrap } = await import('../bootstrap.js')
    let nextId = 0
    const kg = {
      upsertEntity: vi.fn(async () => `uuid-${nextId++}`),
      upsertRelationship: vi.fn(async () => 'rel-id'),
    } as any

    mockSentry((url) => {
      if (url.includes('/issues/')) return { body: [] }
      if (url.includes('cursor=page2')) {
        return { body: [{ id: 'p2', slug: 'svc-b', name: 'B' }], link: '<https://sentry.io/x>; rel="next"; results="false"; cursor="end"' }
      }
      return {
        body: [{ id: 'p1', slug: 'svc-a', name: 'A' }],
        link: '<https://sentry.io/api/0/organizations/acme/projects/?per_page=100&cursor=page2>; rel="next"; results="true"; cursor="page2"',
      }
    })

    const result = await new SentryBootstrap(kg).bootstrap(tenantId, 'conn-1', { token: 'tok', org: 'acme' })
    expect(result.entitiesUpserted).toBe(2) // both pages' projects
  })
})
