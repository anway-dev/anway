// Telemetry must be started before other imports so auto-instrumentation patches modules at load time
import { startTelemetry, shutdownTelemetry } from './telemetry.js'

startTelemetry()

import { buildApp } from './app.js'
import { initMetrics } from './metrics.js'
import { validateEnv } from './config/env.js'

async function main() {
  // Validate environment before any other setup
  const env = validateEnv()
  const port = env.PORT
  const host = env.HOST

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
    app.log.error({ err }, 'failed to start server')
    process.exit(1)
  }
}

void main()
