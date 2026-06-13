import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { isDraining } from '../lifecycle.js'

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

  // Readiness: drains on shutdown, then verifies DB is reachable
  app.get('/health/ready', async (_request, reply) => {
    // During graceful shutdown, signal not-ready so LBs stop routing traffic
    if (isDraining()) {
      return reply.status(503).send({ status: 'draining' })
    }
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

  // Admin-only debug: at-rest secrets check
  app.get('/api/debug/at-rest-check', { preHandler: [app.authenticate] }, async (_request, reply) => {
  try {
    // Debug routes must not exist in production — schema introspection leak.
    if (process.env['NODE_ENV'] === 'production') return reply.code(404).send({ error: 'not found' })
    const user = _request.user as { role?: string }
    if (user.role !== 'admin') return reply.code(403).send({ error: 'admin required' })
    const { prisma } = await import('../db/client.js')
    // Check plaintext columns have been dropped
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public'
      AND ((table_name='connector_config' AND column_name IN ('credentials'))
        OR (table_name='provider_config' AND column_name IN ('api_key')))
    `
    const plaintextColumns = cols.map(c => c.column_name)
    // Check an enc column has v1: prefix
    const samples = await prisma.$queryRaw<{ credentials_enc: string | null }[]>`
      SELECT credentials_enc FROM connector_config LIMIT 1
    `
    const sampleEncPrefix = samples[0]?.credentials_enc?.startsWith('v1:') ?? false
    return { plaintextColumns, sampleEncPrefix }
  } catch (err) {
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'unknown' })
  }
})
}
