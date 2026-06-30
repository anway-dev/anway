import type { IScheduler } from '@anway/agent'
import { BullMQScheduler } from '../jobs/bullmq-scheduler.js'

/**
 * Creates the best available IScheduler for the given environment.
 *
 * Default: BullMQScheduler (Redis-backed, persistent, tested).
 * TriggerDevScheduler is a placeholder for future Trigger.dev integration.
 * When a proper Trigger.dev self-hosted endpoint is configured and the
 * @trigger.dev/sdk is integrated, switch here.
 */
export class SchedulerFactory {
  static create(redisUrl: string): IScheduler {
    return new BullMQScheduler(redisUrl)
  }
}
