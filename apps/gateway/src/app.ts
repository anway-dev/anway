import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import corsPlugin from './plugins/cors.js'
import jwtPlugin from './plugins/jwt.js'
import requestLoggerPlugin from './plugins/request-logger.js'
import { healthRoutes } from './routes/health.js'
import { metricsRoutes } from './routes/metrics.js'
import { authRoutes } from './routes/auth.js'
import { chatRoutes } from './routes/chat.js'
import { incidentRoutes } from './routes/incidents.js'
import { automationsRoutes } from './routes/automations.js'
import { graphEventRoutes } from './routes/graph-events.js'
import { connectorsRoutes } from './routes/connectors.js'
import { serviceRoutes } from './routes/services.js'
import { gateDecideRoutes } from './gate/gate-decide-route.js'
import { settingsRoutes } from './routes/settings.js'
import { eventRoutes } from './routes/events.js'
import { alertRoutes } from './routes/alerts.js'
import { auditRoutes } from './routes/audit.js'
import { httpRequestDuration, httpRequestsTotal } from './metrics.js'

const isDev = process.env.NODE_ENV === 'development'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: {
        service: 'anvay-gateway',
        version: process.env.APP_VERSION ?? '0.0.1',
        env: process.env.NODE_ENV ?? 'development',
      },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      timestamp: true,
      ...(isDev
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    trustProxy: true,
  })

  await app.register(sensible)
  await app.register(corsPlugin)
  await app.register(jwtPlugin)
  await app.register(requestLoggerPlugin)

  // Global rate limit: 100 req/min per IP
  await app.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
  })

  await app.register(healthRoutes)
  await app.register(metricsRoutes)
  await app.register(authRoutes)
  await app.register(chatRoutes)
  await app.register(incidentRoutes)
  await app.register(automationsRoutes)
  await app.register(graphEventRoutes)
  await app.register(connectorsRoutes)
  await app.register(serviceRoutes)
  await app.register(eventRoutes)
  await app.register(settingsRoutes)
  await app.register(gateDecideRoutes)
  await app.register(alertRoutes)
  await app.register(auditRoutes)

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    }
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000)
    httpRequestsTotal.inc(labels)
  })

  return app
}
