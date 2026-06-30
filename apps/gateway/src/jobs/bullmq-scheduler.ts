// BullMQ scheduler — persistent, retry-capable, Redis-backed.
// Replaces node-cron per CLAUDE.md §11 locked decision.
import { Queue, Worker } from 'bullmq'
import type { IScheduler, ScheduledJob } from '@anway/agent'

export class BullMQScheduler implements IScheduler {
  private readonly queue: Queue
  private readonly jobMap = new Map<string, ScheduledJob>()
  private worker: Worker | null = null

  constructor(private readonly redisUrl: string) {
    const connection = { url: this.redisUrl }
    this.queue = new Queue('cron-jobs', { connection })
  }

  async register(job: ScheduledJob): Promise<void> {
    this.jobMap.set(job.name, job)

    // Deduplicate: remove existing repeatable job with same name
    try {
      const existing = await this.queue.getRepeatableJobs()
      const dup = existing.find(j => j.name === job.name)
      if (dup) await this.queue.removeRepeatableByKey(dup.key)
    } catch {
      // Best-effort dedup — register proceeds even if dedup fails
    }

    // Register as a repeatable job with cron pattern
    try {
      await this.queue.add(job.name, { jobId: job.id }, {
        repeat: { pattern: job.schedule },
        jobId: `repeat:${job.id}`,
      })
    } catch (err) {
      throw new Error(`BullMQScheduler: failed to register job "${job.name}": ${err instanceof Error ? err.message : err}`)
    }
  }

  async start(): Promise<void> {
    // Single worker for all cron jobs — dispatches by job name
    if (this.worker) return
    this.worker = new Worker('cron-jobs', async (bullJob) => {
      const job = this.jobMap.get(bullJob.name)
      if (job) return job.run()
    }, { connection: { url: this.redisUrl } })
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close()
      this.worker = null
    }
    await this.queue.close()
  }
}
