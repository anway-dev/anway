// Telemetry must be started before other imports so auto-instrumentation patches modules at load time
import { startTelemetry, shutdownTelemetry } from './telemetry.js'

startTelemetry()

import { buildApp } from './app.js'
import { initMetrics } from './metrics.js'
import { validateEnv } from './config/env.js'
import pino from 'pino'
import { startTriggerSubscriber } from './triggers/subscriber.js'
import { createCronJobs } from './jobs/scheduler.js'
import { startGraphBuilderSubscriber } from './graph-builder/subscriber.js'

const bootstrapLog = pino({ level: 'info' })

async function main() {
  // Validate environment before any other setup
  const env = validateEnv()
  const port = env.PORT
  const host = env.HOST

  let app: Awaited<ReturnType<typeof buildApp>> | undefined

  try {
    initMetrics()
    app = await buildApp()
    const shutdown = async (signal: string) => {
      app!.log.info({ signal }, 'shutdown signal received')
      try {
        await app!.close()
        await shutdownTelemetry()
        app!.log.info('server shut down cleanly')
        process.exit(0)
      } catch (err) {
        app!.log.error({ err }, 'error during shutdown')
        process.exit(1)
      }
    }

    process.on('SIGTERM', () => { void shutdown('SIGTERM') })
    process.on('SIGINT', () => { void shutdown('SIGINT') })

    await app.listen({ port, host })
    app.log.info({ port, host }, 'gateway server started')
    // Start trigger subscriber (non-blocking — fails gracefully without Redis)
    try {
      await startTriggerSubscriber(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
    } catch (err) {
      app.log.warn({ err }, 'Trigger subscriber not started — Redis may be unavailable')
    }
    try {
      const cronScheduler = createCronJobs(process.env['REDIS_URL'] ?? 'redis://localhost:6379')
      await cronScheduler.start()
      app.log.info('Cron scheduler started')
    } catch (err) {
      app.log.warn({ err }, 'Cron scheduler not started — Redis may be unavailable')
    }
    try {
      await startGraphBuilderSubscriber(
        process.env['REDIS_URL'] ?? 'redis://localhost:6379',
        app.log,
      )
    } catch (err) {
      app.log.warn({ err }, 'Graph builder subscriber not started — Redis may be unavailable')
    }
  } catch (err) {
    const log = app?.log ?? bootstrapLog
    log.error({ err }, 'failed to start server')
    process.exit(1)
  }
}

void main()
