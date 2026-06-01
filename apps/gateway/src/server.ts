// Telemetry must be started before other imports so auto-instrumentation patches modules at load time
import { startTelemetry, shutdownTelemetry } from './telemetry'

startTelemetry()

import { buildApp } from './app'
import { initMetrics } from './metrics'
import pino from 'pino'

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? '0.0.0.0'

// Bootstrap logger used before the Fastify app is ready
const bootstrapLog = pino({ level: process.env.LOG_LEVEL ?? 'info' })

async function main() {
  initMetrics()

  const app = await buildApp()

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutdown signal received')
    try {
      await app.close()
      await shutdownTelemetry()
      app.log.info('server shut down cleanly')
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })

  try {
    await app.listen({ port, host })
    app.log.info({ port, host }, 'gateway server started')
  } catch (err) {
    bootstrapLog.error({ err }, 'failed to start server')
    process.exit(1)
  }
}

void main()
