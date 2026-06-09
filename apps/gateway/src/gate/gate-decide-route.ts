import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { RedisGateSink } from './redis-gate-sink.js'

const redisUrl = process.env['REDIS_URL']
const gateSink = redisUrl ? new RedisGateSink(redisUrl) : undefined

export async function gateDecideRoutes(app: FastifyInstance) {
  app.post<{ Params: { gateId: string }; Body: { decision: 'approved' | 'rejected' } }>(
    '/api/gate/:gateId/decide', {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['approved', 'rejected'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { gateId } = request.params
      const { decision } = request.body
      const { sub: userId, tenantId } = request.user as { sub: string; tenantId: string }

      const affected = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE gate_events
          SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
          WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
        `
      )

      if (Number(affected) === 0) {
        return reply.code(404).send({ error: 'gate not found or already decided' })
      }

      // Publish decision to Redis so orchestrator's pollGate() can wake up
      if (gateSink) {
        try {
          await gateSink.record(gateId, decision, userId)
        } catch (err) {
          request.log.warn({ err, gateId }, 'failed to publish gate decision to Redis')
        }
      }

      return { ok: true, gateId, decision }
    },
  )
}
