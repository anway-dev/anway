import Fastify, { type FastifyError } from 'fastify'
import sensible from '@fastify/sensible'
import cookie from '@fastify/cookie'
import corsPlugin from './plugins/cors.js'
import jwtPlugin from './plugins/jwt.js'
import requestLoggerPlugin from './plugins/request-logger.js'
import * as Sentry from '@sentry/node'
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
import { gatePolicyRoutes } from './routes/gate-policies.js'
import { settingsRoutes } from './routes/settings.js'
import { eventRoutes } from './routes/events.js'
import { alertRoutes } from './routes/alerts.js'
import { auditRoutes } from './routes/audit.js'
import { accessRoutes } from './routes/access.js'
import { lifecycleRoutes } from './routes/lifecycle.js'
import { cloudRoutes } from './routes/cloud.js'
import { k8sRoutes } from './routes/k8s.js'
import { oidcRoutes } from './routes/oidc.js'
import { sessionRoutes } from './routes/sessions.js'
import { terraformRoutes } from './routes/terraform.js'
import { editorRoutes } from './routes/editor.js'
import { pipelineRoutes } from './routes/pipeline.js'
import { environmentRoutes } from './routes/environments.js'
import { slackCommandRoutes } from './routes/slack-commands.js'
import { httpRequestDuration, httpRequestsTotal } from './metrics.js'

const isDev = process.env.NODE_ENV === 'development'

export async function buildApp() {
  const app = Fastify({
    bodyLimit: 10 * 1024 * 1024, // 10 MiB — allows large chat context payloads
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
    trustProxy: Number(process.env['TRUST_PROXY_HOPS'] ?? 1),
  })

  await app.register(sensible)
  await app.register(corsPlugin)
  await app.register(jwtPlugin)
  await app.register(requestLoggerPlugin)
  await app.register(cookie)

  // Global rate limit per IP. 300/min for normal API — a single dashboard load
  // legitimately fires dozens of requests, so 100 was too tight. Webhook
  // ingestion (/api/events/*) bursts higher (Alertmanager/CI fan out) → 600/min.
  const rlMax = Number(process.env['RATE_LIMIT_MAX'] ?? 300)
  await app.register(import('@fastify/rate-limit'), {
    max: (req: { url: string }) => (req.url.startsWith('/api/events/') ? rlMax * 2 : rlMax),
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
  await app.register(gatePolicyRoutes)
  await app.register(alertRoutes)
  await app.register(auditRoutes)
  await app.register(accessRoutes)
  await app.register(lifecycleRoutes)
  await app.register(cloudRoutes)
  await app.register(k8sRoutes)
  await app.register(oidcRoutes)
  await app.register(sessionRoutes)
  await app.register(terraformRoutes)
  await app.register(editorRoutes)
  await app.register(pipelineRoutes)
  await app.register(environmentRoutes)
  await app.register(slackCommandRoutes)

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (process.env['SENTRY_DSN']) {
      Sentry.withScope((scope) => {
        scope.setTag('tenantId', (request.user as { tenantId?: string })?.tenantId ?? 'unknown')
        Sentry.captureException(error)
      })
    }
    // Pass through explicit status codes (validation errors, intentional 4xx)
    const status = error.statusCode ?? 500
    if (status < 500) {
      const message = error.validation ? error.message : 'Bad Request'
      return reply.code(status).send({
        error: message,
        // Include AJV validation detail when present
        ...(error.validation ? { validation: error.validation } : {}),
      })
    }
    // Map Prisma unique/FK constraint errors to 409/400 instead of 500
    const prismaCode = (error as { code?: string }).code
    if (prismaCode === 'P2002') return reply.code(409).send({ error: 'Conflict — resource already exists' })
    if (prismaCode === 'P2003') return reply.code(400).send({ error: 'Invalid reference — related resource not found' })
    request.log.error(error)
    return reply.code(500).send({ error: 'Internal server error' })
  })

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
