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

import { startTriggerExecutor } from './executor.js'

describe('startTriggerExecutor', () => {
  beforeEach(() => {
    mockPublish.mockClear()
    mockSubscribeFn.mockClear()
    mockConnect.mockClear()
  })

  it('creates separate sub and pub clients', async () => {
    const { createClient } = await import('redis')
    await startTriggerExecutor('redis://localhost:6379')
    expect(createClient).toHaveBeenCalledTimes(2)
  })

  it('write actions publish to trigger_gate_required', async () => {
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
    expect(mockPublish).toHaveBeenCalledWith(
      'trigger_gate_required',
      expect.stringContaining('create_incident'),
    )
  })

  it('skips invalid JSON messages', async () => {
    mockSubscribeFn.mockImplementationOnce(
      async (_channel: string, cb: (msg: string) => Promise<void>) => {
        await cb('not json')
      },
    )

    await startTriggerExecutor('redis://localhost:6379')
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
