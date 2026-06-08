import { describe, it, expect, vi } from 'vitest'

// Mock bullmq before importing
vi.mock('bullmq', () => ({
  Queue: vi.fn(function (this: Record<string, unknown>) {
    this.add = vi.fn().mockResolvedValue(undefined)
    this.close = vi.fn().mockResolvedValue(undefined)
    return this
  }),
  Worker: vi.fn(function (this: Record<string, unknown>) {
    this.close = vi.fn().mockResolvedValue(undefined)
    return this
  }),
}))

import { BullMQScheduler } from './bullmq-scheduler.js'
import { Queue, Worker } from 'bullmq'

describe('BullMQScheduler', () => {
  it('constructs without error', () => {
    expect(() => new BullMQScheduler('redis://localhost:6379')).not.toThrow()
  })

  it('register resolves without error', async () => {
    const scheduler = new BullMQScheduler('redis://localhost:6379')
    await expect(scheduler.register({
      id: 'test-job',
      name: 'test_job',
      schedule: '*/5 * * * *',
      async run() { return { ok: true } },
    })).resolves.toBeUndefined()
  })

  it('stop resolves without error', async () => {
    const scheduler = new BullMQScheduler('redis://localhost:6379')
    await scheduler.register({
      id: 'j1',
      name: 'test_job',
      schedule: '0 * * * *',
      async run() { return {} },
    })
    await expect(scheduler.stop()).resolves.toBeUndefined()
  })
})
