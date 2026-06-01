import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import corsPlugin from './plugins/cors'
import jwtPlugin from './plugins/jwt'
import requestLoggerPlugin from './plugins/request-logger'
import { healthRoutes } from './routes/health'
import { metricsRoutes } from './routes/metrics'
import { authRoutes } from './routes/auth'
import { httpRequestDuration, httpRequestsTotal } from './metrics'

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

  await app.register(healthRoutes)
  await app.register(metricsRoutes)
  await app.register(authRoutes)

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
