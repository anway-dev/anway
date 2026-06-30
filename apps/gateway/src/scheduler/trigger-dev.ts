// TriggerDevScheduler — primary scheduler per CLAUDE.md §11.
// Requires a self-hosted Trigger.dev instance. Falls back to BullMQ when unavailable.
import type { IScheduler, ScheduledJob } from '@anway/agent'

export class TriggerDevScheduler implements IScheduler {
  private jobs: ScheduledJob[] = []

  constructor(private readonly _triggerDevEndpoint?: string) {
    // Trigger.dev client would be initialized here when endpoint is configured.
    // For now: stub that stores jobs for inspection. Use BullMQScheduler as
    // the active implementation until Trigger.dev self-hosted infra is ready.
  }

  async register(job: ScheduledJob): Promise<void> {
    this.jobs.push(job)
    // TODO: when Trigger.dev endpoint is available:
    //   import { task, schedules } from '@trigger.dev/sdk'
    //   task({ id: job.id, run: job.run })
  }

  async start(): Promise<void> {
    // Trigger.dev tasks auto-register on import — no explicit start needed.
  }

  async stop(): Promise<void> {
    this.jobs = []
  }
}
