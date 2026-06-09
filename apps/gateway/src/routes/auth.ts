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

  // Dev-only: returns a signed JWT + upserts dev tenant/user — no auth required
  // Only available when NODE_ENV=development
  app.get('/api/auth/dev-token', async (request, reply) => {
    if (process.env.NODE_ENV !== 'development') {
      return reply.code(404).send({ error: 'not found' })
    }

    const DEV_TENANT = '00000000-0000-0000-0000-000000000001'
    const DEV_USER = '00000000-0000-0000-0000-000000000002'
    const DEV_EMAIL = 'dev@anvay.local'

    // Upsert tenant + user so withTenant() works downstream
    try {
      await prisma.$executeRaw`
        INSERT INTO tenants (id, name, slug, plan) VALUES (${DEV_TENANT}::uuid, 'Dev Tenant', 'dev', 'tier1')
        ON CONFLICT (id) DO NOTHING
      `
      await prisma.$executeRaw`
        INSERT INTO users (id, tenant_id, email, role) VALUES (${DEV_USER}::uuid, ${DEV_TENANT}::uuid, ${DEV_EMAIL}, 'admin')
        ON CONFLICT (id) DO NOTHING
      `
    } catch { /* table may not exist yet — still return token */ }

    const token = await reply.jwtSign({
      sub: DEV_USER,
      email: DEV_EMAIL,
      tenantId: DEV_TENANT,
      role: 'admin',
    })

    return reply.send({ token, tenantId: DEV_TENANT })
  })
}
