import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { appendAuditEvent } from './audit.js'

interface TokenBody {
  email: string
  tenantId: string
}

// Simple in-memory rate limiter (5 req/min per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_RATE_LIMIT_ENTRIES = 1000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) { const k = rateLimitMap.keys().next().value; if (k !== undefined) rateLimitMap.delete(k) }
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

export async function authRoutes(app: FastifyInstance) {
  // /auth/token is a dev/test shortcut — never available in production.
  // Real auth goes through OIDC (/api/auth/oidc/* routes).
  if (process.env['NODE_ENV'] !== 'production') app.post<{ Body: TokenBody }>('/auth/token', {
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
    const ip = request.ip
    if (!checkRateLimit(ip)) {
      return reply.code(429).send({ error: 'too many requests — try again in 1 minute' })
    }
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

  // Demo login — available when DEMO_MODE=true
  app.post('/api/auth/demo', async (request, reply) => {
    if (process.env['DEMO_MODE'] !== 'true') return reply.code(404).send({ error: 'not found' })
    const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'
    const DEMO_EMAIL = 'admin@demo.anvay.dev'
    let user: { id: string; role: string } | null = null
    try {
      const rows = await prisma.$queryRaw<{ id: string; role: string }[]>`
        SELECT id, role FROM users WHERE tenant_id = ${DEMO_TENANT}::uuid AND email = ${DEMO_EMAIL} LIMIT 1
      `
      user = rows[0] ?? null
    } catch { /* ignore */ }
    if (!user) return reply.code(503).send({ error: 'Demo tenant not seeded — run pnpm seed first' })
    const token = await reply.jwtSign({ sub: user.id, email: DEMO_EMAIL, tenantId: DEMO_TENANT, role: user.role })
    await appendAuditEvent({
      tenantId: DEMO_TENANT,
      userId: 'demo',
      action: 'auth.demo_login',
      resource: 'auth:demo',
      outcome: 'action_executed',
      metadata: { source: 'demo_endpoint' },
    }).catch(() => {})
    return reply.send({ token, expiresIn: '24h' })
  })

  // Dev-only: returns a signed JWT + upserts dev tenant/user — no auth required
  // Only available when NODE_ENV=development
  app.get('/api/auth/dev-token', async (request, reply) => {
    if (process.env.NODE_ENV !== 'development' || process.env['ALLOW_DEV_TOKEN'] !== 'true') {
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

  // GET /api/auth/me — return authenticated user info from JWT
  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user as { sub: string; email: string; tenantId: string; role: string }
    return { email: user.email, role: user.role, tenantId: user.tenantId, sub: user.sub }
  })

  // POST /api/auth/refresh — issue a fresh 24h JWT for an authenticated user
  app.post('/api/auth/refresh', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user as { sub: string; email: string; tenantId: string; role: string }
    const token = await reply.jwtSign(
      { sub: user.sub, email: user.email, tenantId: user.tenantId, role: user.role },
    )
    return reply.send({ token, expiresIn: '24h' })
  })

  // POST /api/auth/logout — signals the client to clear session (JWT is stateless)
  app.post('/api/auth/logout', { preHandler: [app.authenticate] }, async (_request, reply) => {
    return reply.send({ ok: true })
  })
}
