import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.fn().mockResolvedValue(undefined)
const mockSubscribeFn = vi.fn()
const mockConnect = vi.fn().mockResolvedValue(undefined)

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: mockConnect,
    subscribe: mockSubscribeFn,
    publish: mockPublish,
    on: vi.fn(),
  })),
}))

const mockQueryRaw = vi.fn().mockResolvedValue([{ id: 'gate-1' }])
const mockExecuteRaw = vi.fn().mockResolvedValue(1)

vi.mock('../db/prisma.js', () => ({
  prisma: {},
}))

vi.mock('../db/prisma.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    withTenant: vi.fn((_prisma: unknown, _tenantId: string, fn: (tx: unknown) => unknown) => {
      return fn({
        $queryRaw: mockQueryRaw,
        $executeRaw: mockExecuteRaw,
      })
    }),
  }
})

import { startTriggerExecutor } from './executor.js'

describe('startTriggerExecutor', () => {
  beforeEach(() => {
    mockPublish.mockClear()
    mockSubscribeFn.mockClear()
    mockConnect.mockClear()
    mockQueryRaw.mockClear()
  })

  it('creates separate sub and pub clients', async () => {
    const { createClient } = await import('redis')
    await startTriggerExecutor('redis://localhost:6379')
    expect(createClient).toHaveBeenCalled()
  })

  it('write actions insert gate_events row and publish to trigger_gate_required', async () => {
    mockSubscribeFn.mockImplementationOnce(
      async (_channel: string, cb: (msg: string) => Promise<void>) => {
        await cb(JSON.stringify({
          tenantId: 't-1',
          channel: 'deploy_failed',
          actions: [{ type: 'create_incident', params: {} }],
        }))
      },
    )

    await startTriggerExecutor('redis://localhost:6379')

    // gate_events row should be inserted via queryRaw
    expect(mockQueryRaw).toHaveBeenCalled()

    // trigger_gate_required still published for backward compat
    expect(mockPublish).toHaveBeenCalledWith(
      'trigger_gate_required',
      expect.stringContaining('create_incident'),
    )
  })

  it('surface_context executes immediately without gate', async () => {
    mockSubscribeFn.mockImplementationOnce(
      async (_channel: string, cb: (msg: string) => Promise<void>) => {
        await cb(JSON.stringify({
          tenantId: 't-2',
          channel: 'alert_fired',
          eventType: 'alert_fired',
          actions: [{ type: 'surface_context', params: { event_type: 'test', summary: 'test context' } }],
        }))
      },
    )

    await startTriggerExecutor('redis://localhost:6379')
    // surface_context should insert into signal_inbox (via queryRaw)
    expect(mockQueryRaw).toHaveBeenCalled()
  })

  it('skips invalid JSON messages', async () => {
    mockSubscribeFn.mockImplementationOnce(
      async (_channel: string, cb: (msg: string) => Promise<void>) => {
        await cb('not json')
      },
    )

    await startTriggerExecutor('redis://localhost:6379')
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it('blocked by perimeter does not insert gate_events', async () => {
    mockSubscribeFn.mockImplementationOnce(
      async (_channel: string, cb: (msg: string) => Promise<void>) => {
        await cb(JSON.stringify({
          tenantId: 't-3',
          channel: 'deploy_failed',
          actions: [{ type: 'create_incident', params: {} }],
          perimeters: [{ connectorId: 'pagerduty', read: [], write: [] }],
        }))
      },
    )

    await startTriggerExecutor('redis://localhost:6379')
    // No write permission → action blocked, no gate_events INSERT
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })
})
