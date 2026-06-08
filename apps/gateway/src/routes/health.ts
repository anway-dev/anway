import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'

const startTime = Date.now()

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      version: process.env.APP_VERSION ?? '0.0.1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
    })
  })

  app.get('/health/live', async (_request, reply) => {
    return reply.send({ status: 'ok' })
  })

  // Readiness: verifies DB is reachable
  app.get('/health/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return reply.send({ status: 'ok', db: 'connected' })
    } catch (err) {
      return reply.status(503).send({
        status: 'not_ready',
        db: 'unreachable',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  })

  app.get('/health/startup', async (_request, reply) => {
    return reply.send({ status: 'ok' })
  })
}
