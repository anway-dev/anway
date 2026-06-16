import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { getMetricsText, getMetricsContentType } from '../metrics.js'

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (request, reply) => {
    const metricsToken = process.env['METRICS_TOKEN']
    if (metricsToken) {
      const supplied = (request.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '')
      const ok = supplied.length === metricsToken.length &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(metricsToken))
      if (!ok) return reply.code(401).send({ error: 'unauthorized' })
    }
    reply.header('Content-Type', getMetricsContentType())
    return reply.send(await getMetricsText())
  })
}
