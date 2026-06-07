import type { FastifyInstance } from 'fastify'
import { getMetricsText, getMetricsContentType } from '../metrics.js'

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', getMetricsContentType())
    return reply.send(await getMetricsText())
  })
}
