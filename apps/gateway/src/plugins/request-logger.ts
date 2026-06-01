import fp from 'fastify-plugin'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string
    tenantId?: string
    userId?: string
  }
}

export default fp(async function requestLoggerPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    const traceId =
      (request.headers['x-trace-id'] as string | undefined) ?? randomUUID()
    request.traceId = traceId
  })

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        traceId: request.traceId,
        tenantId: request.tenantId ?? null,
        userId: request.userId ?? null,
        method: request.method,
        path: request.url,
        status: reply.statusCode,
        duration_ms: reply.elapsedTime,
      },
      'request completed',
    )
  })
})
