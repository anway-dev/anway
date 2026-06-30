// Telemetry must be started before other imports so auto-instrumentation patches modules at load time
import { startTelemetry, shutdownTelemetry } from './telemetry.js'

startTelemetry()

import * as Sentry from '@sentry/node'

if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 0.1,
  })
}

import { buildApp } from './app.js'
import { initMetrics } from './metrics.js'
import { validateEnv, assertSecureJwtSecret } from './config/env.js'
import { assertEncryptionKey } from './utils/crypto.js'
import pino from 'pino'
import { startTriggerSubscriber } from './triggers/subscriber.js'
import { createCronJobs } from './jobs/scheduler.js'
import { startGraphBuilderSubscriber, startGraphBuilderWorker } from './graph-builder/subscriber.js'
import { bootstrapUnindexedConnectors } from './graph-builder/boot-scan.js'
import { startTriggerExecutor } from './triggers/executor.js'
import { startIncidentSubscriber } from './events/incident-subscriber.js'
import { startAlertSubscriber } from './events/alert-subscriber.js'
import { beginDraining, isDraining } from './lifecycle.js'
import { startPipelineBootstrapSubscriber } from './pipeline-bootstrap.js'
import type { IScheduler } from '@anway/agent'

const DEFAULT_REDIS_URL = 'redis://localhost:6379'
const bootstrapLog = pino({ level: 'info' })

process.on('unhandledRejection', (reason, promise) => {
  console.error({ msg: 'unhandledRejection', reason, promise })
})

process.on('uncaughtException', (err) => {
  console.error({ msg: 'uncaughtException', err })
  process.exit(1)
})

async function main() {
  // Validate environment before any other setup
  const env = validateEnv()
  assertSecureJwtSecret()
  assertEncryptionKey()

  // M4: DEMO_MODE=true must not reach production
  if (process.env['DEMO_MODE'] === 'true' && process.env['NODE_ENV'] === 'production') {
    console.error('FATAL: DEMO_MODE=true is not allowed in NODE_ENV=production. Unset DEMO_MODE before deploying.')
    process.exit(1)
  }
  const port = env.PORT
  const host = env.HOST

  let app: Awaited<ReturnType<typeof buildApp>> | undefined
  // Scheduler handle hoisted so the shutdown handler can stop it.
  let cronScheduler: IScheduler | undefined

  // Grace period (ms) between marking not-ready and closing the server,
  // giving load balancers time to stop routing and in-flight requests to drain.
  const DRAIN_GRACE_MS = Number(process.env['SHUTDOWN_GRACE_MS'] ?? 3000)

  try {
    initMetrics()
    app = await buildApp()
    const shutdown = async (signal: string) => {
      // Guard against double-invocation (e.g. SIGINT after SIGTERM)
      if (isDraining()) return
      beginDraining()
      app!.log.info({ signal }, 'shutdown signal received — draining')
      try {
        // /health/ready now returns 503; wait for LBs to stop routing
        await new Promise((r) => setTimeout(r, DRAIN_GRACE_MS))
        try {
          await cronScheduler?.stop()
        } catch (err) {
          app!.log.warn({ err }, 'error stopping cron scheduler during shutdown')
        }
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
      await startTriggerSubscriber(process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL)
    } catch (err) {
      app.log.warn({ err }, 'Trigger subscriber not started — Redis may be unavailable')
    }
    try {
      cronScheduler = await createCronJobs(process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL)
      await cronScheduler.start()
      app.log.info('Cron scheduler started')
    } catch (err) {
      app.log.warn({ err }, 'Cron scheduler not started — Redis may be unavailable')
    }
    try {
      await startGraphBuilderSubscriber(
        process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL,
        app.log,
      )
    } catch (err) {
      app.log.warn({ err }, 'Graph builder subscriber not started — Redis may be unavailable')
    }
    try {
      await startGraphBuilderWorker(
        process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL,
        app.log,
      )
    } catch (err) {
      app.log.warn({ err }, 'Graph builder worker not started — Redis may be unavailable')
    }
    // Boot-time scan — publish connector_registered for connectors with no bootstrapped_at
    try {
      await bootstrapUnindexedConnectors(process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL, app.log)
    } catch (err) {
      app.log.warn({ err }, 'boot-time connector scan failed — skipping')
    }
    try {
      await startTriggerExecutor(process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL)
    } catch (err) {
      app.log.warn({ err }, 'Trigger executor not started — Redis may be unavailable')
    }
    try {
      await startIncidentSubscriber(process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL)
    } catch (err) {
      app.log.warn({ err }, 'Incident subscriber not started — Redis may be unavailable')
    }
    try {
      await startAlertSubscriber(process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL)
    } catch (err) {
      app.log.warn({ err }, 'Alert subscriber not started — Redis may be unavailable')
    }
    try {
      await startPipelineBootstrapSubscriber(process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL, app.log)
    } catch (err) {
      app.log.warn({ err }, 'Pipeline bootstrap subscriber not started — Redis may be unavailable')
    }
  } catch (err) {
    const log = app?.log ?? bootstrapLog
    log.error({ err }, 'failed to start server')
    process.exit(1)
  }
}

void main()
