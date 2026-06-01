import type { FastifyInstance } from 'fastify'

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

  // Readiness: verifies dependencies are reachable (DB, Redis added in later milestones)
  app.get('/health/ready', async (_request, reply) => {
    return reply.send({ status: 'ok' })
  })

  app.get('/health/startup', async (_request, reply) => {
    return reply.send({ status: 'ok' })
  })
}
