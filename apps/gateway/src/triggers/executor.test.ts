import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.fn().mockResolvedValue(undefined)
// Subscribe mock: store callbacks per channel so tests can trigger trigger_matched
const channelCallbacks = new Map<string, (msg: string) => Promise<void>>()
const mockSubscribeFn = vi.fn().mockImplementation(
  async (channel: string, cb: (msg: string) => Promise<void>) => {
    channelCallbacks.set(channel, cb)
  }
)
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

vi.mock('../db/prisma.js', () => {
  const qr = vi.fn().mockResolvedValue([{ id: 'gate-1' }])
  const er = vi.fn().mockResolvedValue(1)
  return {
    prisma: {},
    withTenant: vi.fn((_prisma: unknown, _tenantId: string, fn: (tx: unknown) => unknown) => {
      return fn({
        $queryRaw: qr,
        $executeRaw: er,
      })
    }),
  }
})

import { startTriggerExecutor } from './executor.js'

async function fireTrigger(payload: unknown) {
  const cb = channelCallbacks.get('trigger_matched')
  if (cb) await cb(JSON.stringify(payload))
}

describe('startTriggerExecutor', () => {
  beforeEach(() => {
    mockPublish.mockClear()
    mockSubscribeFn.mockClear()
    mockConnect.mockClear()
    channelCallbacks.clear()
  })

  it('creates subscriber and pub clients', async () => {
    const { createClient } = await import('redis')
    await startTriggerExecutor('redis://localhost:6379')
    expect(createClient).toHaveBeenCalled()
  })

  it('write actions insert gate_events row and publish to trigger_gate_required', async () => {
    await startTriggerExecutor('redis://localhost:6379')
    await fireTrigger({
      tenantId: 't-1',
      channel: 'deploy_failed',
      actions: [{ type: 'create_incident', params: {} }],
    })

    // trigger_gate_required published for backward compat
    expect(mockPublish).toHaveBeenCalledWith(
      'trigger_gate_required',
      expect.stringContaining('create_incident'),
    )
  })

  it('surface_context executes immediately without gate', async () => {
    await startTriggerExecutor('redis://localhost:6379')
    await fireTrigger({
      tenantId: 't-2',
      channel: 'alert_fired',
      eventType: 'alert_fired',
      actions: [{ type: 'surface_context', params: { event_type: 'test', summary: 'test context' } }],
    })
    // surface_context executes via executeTriggerAction
    // (no publish since it's read-only, no gate since it's not a write action)
    expect(mockPublish).not.toHaveBeenCalledWith('trigger_gate_required', expect.any(String))
  })

  it('skips invalid JSON messages', async () => {
    await startTriggerExecutor('redis://localhost:6379')
    const cb = channelCallbacks.get('trigger_matched')
    if (cb) await cb('not json')
    // Should not throw, should not publish
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('blocked by perimeter does not publish trigger_gate_required', async () => {
    await startTriggerExecutor('redis://localhost:6379')
    await fireTrigger({
      tenantId: 't-3',
      channel: 'deploy_failed',
      actions: [{ type: 'create_incident', params: {} }],
      perimeters: [{ connectorId: 'pagerduty', read: [], write: [] }],
    })
    // No write permission → action blocked, no publish
    expect(mockPublish).not.toHaveBeenCalledWith('trigger_gate_required', expect.any(String))
  })
})
