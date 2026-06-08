import type { IScheduler } from '@anvay/agent'
import { BullMQScheduler } from '../jobs/bullmq-scheduler.js'
import { TriggerDevScheduler } from './trigger-dev.js'

/**
 * Creates the best available IScheduler for the given environment.
 *
 * Priority: TriggerDev (primary) → BullMQ (fallback).
 * When TRIGGERDEV_ENDPOINT is set, uses TriggerDevScheduler.
 * Otherwise falls back to BullMQScheduler backed by Redis.
 */
export class SchedulerFactory {
  static create(redisUrl: string): IScheduler {
    const triggerDevEndpoint = process.env['TRIGGERDEV_ENDPOINT']
    if (triggerDevEndpoint) {
      return new TriggerDevScheduler(triggerDevEndpoint)
    }
    return new BullMQScheduler(redisUrl)
  }
}
