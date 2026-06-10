import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { createClient } from 'redis'

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

    return connectors.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      mode: c.mode,
      createdAt: c.created_at,
    }))
  })

  // T9: Bootstrap status
  app.get<{ Params: { type: string } }>('/api/connectors/:type/bootstrap-status', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { type } = request.params
    const row = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ bootstrapped_at: Date | null; last_bootstrap_summary: unknown }[]>`
        SELECT bootstrapped_at AS bootstrapped_at, last_bootstrap_summary AS last_bootstrap_summary
        FROM connector_config WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
      `
    ).catch(() => [])
    if (row.length === 0) return { bootstrapped: false }
    return { bootstrapped: row[0]!.bootstrapped_at !== null, bootstrappedAt: row[0]!.bootstrapped_at, summary: row[0]!.last_bootstrap_summary }
  })

  // T9: Trigger bootstrap
  app.post<{ Params: { type: string } }>('/api/connectors/:type/bootstrap', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { type } = request.params
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ credentials: Record<string, unknown> }>>`
        SELECT credentials FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
      `
    ).catch(() => [])
    const creds = (rows[0]?.credentials ?? {}) as Record<string, unknown>

    const pub = await getBootstrapPub()
    if (pub) {
      await pub.publish('connector_registered', JSON.stringify({
        type: 'connector_registered',
        tenantId,
        connectorType: type,
        connectorId: type,
        payload: creds,
      }))
    }
    return { ok: true, message: `Bootstrap triggered for ${type}` }
  })
}

let _pub: import('redis').RedisClientType | null = null

async function getBootstrapPub(): Promise<import('redis').RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (!_pub) {
    _pub = createClient({ url }) as import('redis').RedisClientType
    await _pub.connect()
  }
  return _pub
}
