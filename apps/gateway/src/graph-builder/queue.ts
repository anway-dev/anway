import { Queue, Worker } from 'bullmq'
import type { GraphEvent } from '@anvay/agent'
import { GraphBuilderAgent } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

const QUEUE_NAME = 'graph-events'

function getRedisConnection() {
  const url = process.env['REDIS_URL']
  if (!url) return null
  return { url }
}

export const graphQueue = getRedisConnection()
  ? new Queue(QUEUE_NAME, { connection: getRedisConnection()! })
  : null

export function startGraphWorker(
  handler: (job: { data: { event: GraphEvent } }) => Promise<void>,
) {
  const conn = getRedisConnection()
  if (!conn) return null
  return new Worker(QUEUE_NAME, handler, {
    connection: conn,
  })
}

export async function enqueueGraphEvent(event: GraphEvent & { tenantId: string }): Promise<void> {
  if (!graphQueue) {
    // No Redis — fall back to in-process processing (no queue, no retry)
    return
  }
  await graphQueue.add('event', { event }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}
