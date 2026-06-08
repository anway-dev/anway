export interface ScheduledJob {
  id: string
  schedule: string  // cron expression
  name: string
  run(): Promise<unknown>
}

export interface IScheduler {
  register(job: ScheduledJob): void
  start(): Promise<void>
  stop(): Promise<void>
}
