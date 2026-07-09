import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/client.js', () => ({ prisma: {} }))
const qr = vi.fn()
vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
    fn({ $queryRaw: qr, $executeRaw: vi.fn() })
  ),
}))

import { correlateIncidentToDeploys } from './incident-correlation.js'

beforeEach(() => {
  qr.mockReset()
})

function fakeKg() {
  return {
    upsertEntity: vi.fn(async () => 'incident-entity-uuid'),
    upsertRelationship: vi.fn(async () => 'rel-uuid'),
  }
}

describe('correlateIncidentToDeploys', () => {
  it('writes CAUSED_BY with 0.8 confidence for a deploy within 30 minutes', async () => {
    qr.mockResolvedValueOnce([
      { id: 'deploy-1', name: 'payments-api#42', minutes_before: 12 },
    ])
    const kg = fakeKg()
    const result = await correlateIncidentToDeploys(kg as never, 't-1', 'inc-1', 'HighErrorRate', 'payments-api — errors', 'payments-api')
    expect(result.correlated).toBe(1)
    expect(kg.upsertRelationship).toHaveBeenCalledWith(expect.objectContaining({
      fromEntityId: 'incident-entity-uuid',
      relType: 'CAUSED_BY',
      toEntityId: 'deploy-1',
      metadata: expect.objectContaining({ confidence: 0.8, unconfirmed: false, source: 'deploy-time-correlation' }),
    }), 't-1')
  })

  it('marks a 2-hour-window match unconfirmed (0.6 < 0.7 KB policy)', async () => {
    qr.mockResolvedValueOnce([
      { id: 'deploy-2', name: 'payments-api#41', minutes_before: 95 },
    ])
    const kg = fakeKg()
    await correlateIncidentToDeploys(kg as never, 't-1', 'inc-1', 'HighErrorRate', undefined, 'payments-api')
    expect(kg.upsertRelationship).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ confidence: 0.6, unconfirmed: true }),
    }), 't-1')
  })

  it('falls back to Service-entity name matching against the incident text when no serviceHint', async () => {
    // First query: Service names (longest first). Second: deploy candidates.
    qr.mockResolvedValueOnce([{ name: 'payments-api' }, { name: 'api' }])
    qr.mockResolvedValueOnce([{ id: 'deploy-3', name: 'payments-api#40', minutes_before: 20 }])
    const kg = fakeKg()
    const result = await correlateIncidentToDeploys(kg as never, 't-1', 'inc-2', 'Errors spiking on payments-api checkout', undefined, undefined)
    expect(result.correlated).toBe(1)
  })

  it('writes nothing when no service can be resolved', async () => {
    qr.mockResolvedValueOnce([{ name: 'payments-api' }])
    const kg = fakeKg()
    const result = await correlateIncidentToDeploys(kg as never, 't-1', 'inc-3', 'PrometheusMissingRuleEvaluations', undefined, undefined)
    expect(result.correlated).toBe(0)
    expect(kg.upsertRelationship).not.toHaveBeenCalled()
  })

  it('writes nothing when no deploys landed in the window', async () => {
    qr.mockResolvedValueOnce([]) // deploy candidates (serviceHint present → no service-list query)
    const kg = fakeKg()
    const result = await correlateIncidentToDeploys(kg as never, 't-1', 'inc-4', 'HighErrorRate', undefined, 'payments-api')
    expect(result.correlated).toBe(0)
    expect(kg.upsertEntity).not.toHaveBeenCalled()
  })
})
