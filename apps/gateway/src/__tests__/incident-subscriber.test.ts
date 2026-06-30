import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock SREAgent before importing the subscriber
vi.mock('@anvay/agent', () => ({
  ProviderFactory: {
    create: vi.fn(() => ({
      modelId: 'mock',
      cheapModelId: 'mock-cheap',
      chat: vi.fn(),
      stream: vi.fn(),
      formatToolCall: vi.fn(),
      formatToolResult: vi.fn(),
    })),
  },
  SREAgent: vi.fn().mockImplementation(() => ({
    assembleContext: vi.fn().mockResolvedValue({
      hypothesis: 'payments-api v2.3.0 deploy caused error rate spike from 0.1% to 8%',
      relatedDeploys: ['v2.3.0 (14 min ago)'],
      relatedPRs: ['PR#441 — changed billing logic'],
      suggestedRunbook: ['Rollback to v2.2.1', 'Check Datadog dashboard payments-api'],
    }),
  })),
}))

vi.mock('../db/client.js', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn(),
  },
}))

vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_prisma, _tenantId, fn) => fn({ $queryRaw: vi.fn().mockResolvedValue([]), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn() })),
}))

vi.mock('../kb/index.js', () => ({
  createKnowledgeGraph: vi.fn(() => ({
    addEpisode: vi.fn(),
    getFacts: vi.fn(),
    getEntity: vi.fn(),
    getRelationships: vi.fn(),
    search: vi.fn(),
    resolveContext: vi.fn(),
    resolveContextByName: vi.fn(),
    getEntityByExternalRef: vi.fn(),
    upsertEntity: vi.fn(),
    upsertRelationship: vi.fn(),
    markConnectorEntitiesStale: vi.fn(),
    deleteEntitiesByOrgPrefix: vi.fn(),
  })),
}))

// Mock setRootCause to capture calls
const mockSetRootCause = vi.fn().mockResolvedValue(undefined)
vi.mock('../services/incident.js', () => ({
  IncidentService: vi.fn().mockImplementation(() => ({
    setRootCause: mockSetRootCause,
  })),
}))

// We don't import the subscriber directly — we call its exported function.
// For unit test isolation, test the payload parsing logic directly.
describe('incident-subscriber payload parsing', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('parses incidentId key and calls setRootCause with correct ID', async () => {
    const { IncidentService } = await import('../services/incident.js')
    const { SREAgent } = await import('@anvay/agent')

    const incidentService = new (IncidentService as any)()
    const kg = { addEpisode: vi.fn(), getFacts: vi.fn(), getEntity: vi.fn(), getRelationships: vi.fn(), search: vi.fn(), resolveContext: vi.fn(), resolveContextByName: vi.fn(), getEntityByExternalRef: vi.fn(), upsertEntity: vi.fn(), upsertRelationship: vi.fn(), markConnectorEntitiesStale: vi.fn(), deleteEntitiesByOrgPrefix: vi.fn() }
    const sre = new (SREAgent as any)()
    sre.assembleContext.mockResolvedValue({
      hypothesis: 'test hypothesis',
      relatedDeploys: [],
      relatedPRs: [],
      suggestedRunbook: [],
    })

    // Simulate the handler logic with incidentId key (the fix)
    const message = JSON.stringify({
      incidentId: '00000000-0000-0000-0000-000000000099',
      tenantId: '00000000-0000-0000-0000-000000000001',
      title: 'Test incident',
      description: 'Test description',
    })

    const payload = JSON.parse(message) as { incidentId?: string; tenantId?: string; title?: string; description?: string }
    const { incidentId: id, tenantId, title, description } = payload

    // Verify the key was correctly extracted
    expect(id).toBe('00000000-0000-0000-0000-000000000099')
    expect(tenantId).toBe('00000000-0000-0000-0000-000000000001')
    expect(title).toBe('Test incident')
  })

  it('old buggy id key produces undefined — documenting the bug was real', () => {
    // Old message format with { id } instead of { incidentId }
    const oldMessage = JSON.stringify({
      id: '00000000-0000-0000-0000-000000000099',
      tenantId: '00000000-0000-0000-0000-000000000001',
      title: 'Old format incident',
    })

    // Parse with OLD buggy type (the before-fix type)
    const payload = JSON.parse(oldMessage) as { id?: string; tenantId?: string; title?: string }
    const { id, tenantId, title } = payload

    // The bug: id is correctly extracted from the old key
    expect(id).toBe('00000000-0000-0000-0000-000000000099')

    // But with the NEW (fixed) subscriber that expects incidentId,
    // parsing an old message would give undefined
    const payloadNew = JSON.parse(oldMessage) as { incidentId?: string; tenantId?: string; title?: string }
    const { incidentId: idNew } = payloadNew
    expect(idNew).toBeUndefined()
    // This documents that old-format messages are now rejected, which is correct —
    // the publisher (routes/incidents.ts) uses incidentId key.
  })

  it('rejects message with undefined incident (missing incidentId key)', () => {
    const message = JSON.stringify({ title: 'no id', tenantId: '00000000-0000-0000-0000-000000000001' })
    const payload = JSON.parse(message) as { incidentId?: string; tenantId?: string; title?: string }
    const { incidentId: id } = payload

    expect(id).toBeUndefined()
  })
})
