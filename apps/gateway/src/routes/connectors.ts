import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

export async function connectorsRoutes(app: FastifyInstance) {
  app.get('/api/connectors', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }

    const connectors = await withTenant(prisma, tenantId, (tx) =>
      tx.connector.findMany({
        where: { tenant_id: tenantId },
        select: {
          id: true,
          name: true,
          type: true,
          mode: true,
          created_at: true,
        },
      }),
    )

    // Map snake_case DB columns to camelCase API response
    return connectors.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      mode: c.mode,
      createdAt: c.created_at,
    }))
  })
}
