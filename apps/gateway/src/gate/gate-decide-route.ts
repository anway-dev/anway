import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'

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

      await prisma.$executeRaw`
        UPDATE gate_events
        SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
        WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid
      `

      return { ok: true, gateId, decision }
    },
  )
}
