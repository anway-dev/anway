// BullMQ scheduler — persistent, retry-capable, Redis-backed.
// Replaces node-cron per CLAUDE.md §11 locked decision.
import { Queue, Worker } from 'bullmq'
import type { IScheduler, ScheduledJob } from '@anvay/agent'

export class BullMQScheduler implements IScheduler {
  private readonly queue: Queue
  private workers: Worker[] = []

  constructor(private readonly redisUrl: string) {
    const connection = { url: this.redisUrl }
    this.queue = new Queue('cron-jobs', { connection })
  }

  async register(job: ScheduledJob): Promise<void> {
    // Register as a repeatable job with cron pattern
    try {
      await this.queue.add(job.name, { jobId: job.id }, {
        repeat: { pattern: job.schedule },
        jobId: `repeat:${job.id}`,
      })
    } catch (err) {
      throw new Error(`BullMQScheduler: failed to register job "${job.name}": ${err instanceof Error ? err.message : err}`)
    }

    // Worker that runs the job when scheduled
    const worker = new Worker('cron-jobs', async (bullJob) => {
      if (bullJob.name === job.name) return job.run()
    }, { connection: { url: this.redisUrl } })
    this.workers.push(worker)
  }

  async start(): Promise<void> {
    // Workers auto-start on construction
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map(w => w.close()))
    await this.queue.close()
  }
}
