import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/client.js', () => ({ prisma: {} }))

const qr = vi.fn()
const er = vi.fn()
vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
    fn({ $queryRaw: qr, $executeRaw: er })
  ),
}))

import { publishDurable, claimEvent } from './durable-events.js'

beforeEach(() => {
  qr.mockReset()
  er.mockReset()
})

describe('publishDurable', () => {
  it('writes the outbox row first, then publishes with __eventLogId attached', async () => {
    qr.mockResolvedValueOnce([{ id: 'evt-1' }])
    const publish = vi.fn().mockResolvedValue(1)

    await publishDurable({ publish } as never, 't-1', 'incident_created', { type: 'incident_created', tenantId: 't-1' })

    expect(qr).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)
    const [channel, message] = publish.mock.calls[0] as [string, string]
    expect(channel).toBe('incident_created')
    expect(JSON.parse(message).__eventLogId).toBe('evt-1')
  })

  it('degrades to ephemeral publish (no id) when the outbox insert fails', async () => {
    // The exact pre-existing at-most-once behavior — never DROP the event
    // just because durability bookkeeping failed.
    qr.mockRejectedValueOnce(new Error('db down'))
    const publish = vi.fn().mockResolvedValue(1)

    await publishDurable({ publish } as never, 't-1', 'alert_fired', { tenantId: 't-1' })

    expect(publish).toHaveBeenCalledTimes(1)
    const [, message] = publish.mock.calls[0] as [string, string]
    expect(JSON.parse(message).__eventLogId).toBeUndefined()
  })

  it('survives a publish failure after a successful insert (replayer picks it up)', async () => {
    qr.mockResolvedValueOnce([{ id: 'evt-2' }])
    const publish = vi.fn().mockRejectedValue(new Error('redis down'))
    await expect(publishDurable({ publish } as never, 't-1', 'pr_merged', { tenantId: 't-1' })).resolves.toBeUndefined()
  })

  it('writes the outbox row even with a null pub (durability without transport)', async () => {
    qr.mockResolvedValueOnce([{ id: 'evt-3' }])
    await publishDurable(null, 't-1', 'deploy_completed', { tenantId: 't-1' })
    expect(qr).toHaveBeenCalledTimes(1)
  })
})

describe('claimEvent', () => {
  it('returns true when this replica wins the claim (1 row inserted)', async () => {
    er.mockResolvedValueOnce(1)
    expect(await claimEvent('evt-1', 't-1', 'graph-builder')).toBe(true)
  })

  it('returns false when another replica already claimed (ON CONFLICT no-op)', async () => {
    er.mockResolvedValueOnce(0)
    expect(await claimEvent('evt-1', 't-1', 'graph-builder')).toBe(false)
  })

  it('returns true for a legacy message with no eventLogId (no dedupe possible)', async () => {
    expect(await claimEvent(undefined, 't-1', 'graph-builder')).toBe(true)
    expect(er).not.toHaveBeenCalled()
  })

  it('returns true when the claim insert itself fails — never drop an event on bookkeeping failure', async () => {
    er.mockRejectedValueOnce(new Error('db down'))
    expect(await claimEvent('evt-1', 't-1', 'graph-builder')).toBe(true)
  })
})
