import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { RedisGateSink } from './redis-gate-sink.js'
import { getMemoryGateSink } from './memory-gate-fallback.js'
import { UUID_RE } from '../utils/validators.js'

const redisUrl = process.env['REDIS_URL']
const gateSink = redisUrl ? new RedisGateSink(redisUrl) : null

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
      if (!UUID_RE.test(gateId)) return reply.code(400).send({ error: 'invalid gateId' })
      const { decision } = request.body
      const { sub: userId, tenantId } = request.user as { sub: string; tenantId: string }

      if (redisUrl) {
        // Redis path: gate_events row required; decision published via Redis
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
        try {
          await gateSink!.record(gateId, decision, userId)
        } catch (err) {
          request.log.warn({ err, gateId }, 'failed to publish gate decision to Redis')
        }
      } else {
        // In-memory path: no gate_events row; resolve pollGate() directly
        await getMemoryGateSink().record(gateId, decision, userId)
      }

      return { ok: true, gateId, decision }
    },
  )

  // Create a gate (for seeding approvals in tests)
  app.post<{ Body: { action: string; target: string; requestedBy?: string } }>(
    '/api/gate',
    {
      preHandler: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['action', 'target'],
          properties: {
            action: { type: 'string' },
            target: { type: 'string' },
            requestedBy: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { action, target, requestedBy } = request.body
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const toolArgs = JSON.stringify({ target, requestedBy: requestedBy ?? 'system' })
      const row = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, created_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
                  ${action}, ${toolArgs}::jsonb, 'test', 'pending', NOW())
          RETURNING id
        `
      )
      return reply.code(201).send({ ok: true, id: (row as Array<{ id: string }>)[0]?.id })
    },
  )
}
