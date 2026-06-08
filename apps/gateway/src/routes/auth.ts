import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

interface TokenBody {
  email: string
  tenantId: string
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: TokenBody }>('/auth/token', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'tenantId'],
        properties: {
          email: { type: 'string' },
          tenantId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { email, tenantId } = request.body

    // Verify tenant exists
    let tenantExists = false
    try {
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`
      )
      tenantExists = rows.length > 0
    } catch { /* fall through to 400 */ }
    if (!tenantExists) return reply.code(400).send({ error: 'invalid tenantId' })

    // Look up user — no auto-provision (provisioned by admin)
    let user: { id: string; role: string } | null = null
    try {
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ id: string; role: string }[]>`
          SELECT id, role FROM users WHERE tenant_id = ${tenantId}::uuid AND email = ${email} LIMIT 1
        `
      )
      user = rows[0] ?? null
    } catch { /* DB unavailable */ }

    if (!user) return reply.code(401).send({ error: 'user not found' })

    const token = await reply.jwtSign({
      sub: user.id,
      email,
      tenantId,
      role: user.role,
    })

    return reply.send({ token, expiresIn: '24h' })
  })
}
