import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { appendAuditEvent } from './audit.js'
import { compare, hash } from 'bcryptjs'

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


  // GET /api/auth/methods — which login methods are enabled (no secrets exposed)
  app.get('/api/auth/methods', async (_request, reply) => {
    const localEnabled = process.env['LOCAL_AUTH_DISABLED'] !== 'true'
    let setupRequired = false
    if (localEnabled) {
      try {
        const rows = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL
        `
        setupRequired = Number(rows[0]?.count ?? 0) === 0
      } catch { /* DB unavailable — don't block login page */ }
    }
    return reply.send({
      local: localEnabled,
      demo: process.env['DEMO_MODE'] === 'true',
      oidc: !!process.env['OIDC_ISSUER_URL'],
      google: !!process.env['GOOGLE_CLIENT_ID'],
      github: !!process.env['GITHUB_CLIENT_ID'],
      setupRequired,
    })
  })

  // POST /api/auth/setup — create first admin user (blocked once any local user exists)
  app.post<{ Body: { email: string; password: string } }>('/api/auth/setup', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (process.env['LOCAL_AUTH_DISABLED'] === 'true') {
      return reply.code(404).send({ error: 'local auth disabled' })
    }
    const existing = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL
    `
    if (Number(existing[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: 'setup already complete' })
    }
    const { email, password } = request.body
    if (password.length < 8) {
      return reply.code(400).send({ error: 'password must be at least 8 characters' })
    }
    const tenantId = process.env['OIDC_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001'
    // Auto-provision tenant + default environments on first run
    await prisma.$executeRaw`
      INSERT INTO tenants (id, name, slug, plan, token_budget_monthly, connector_limit)
      VALUES (${tenantId}::uuid, 'My Organisation', 'default', 'tier2', 10000000, 10)
      ON CONFLICT (id) DO NOTHING
    `
    await prisma.$executeRaw`
      INSERT INTO environments (id, tenant_id, name, label, color, sort_order)
      VALUES
        (gen_random_uuid(), ${tenantId}::uuid, 'staging', 'Staging',        '#3b82f6', 0),
        (gen_random_uuid(), ${tenantId}::uuid, 'preprod', 'Pre-production', '#f59e0b', 1),
        (gen_random_uuid(), ${tenantId}::uuid, 'prod',    'Production',     '#10b981', 2)
      ON CONFLICT DO NOTHING
    `
    const passwordHash = await hash(password, 12)
    const rows = await prisma.$queryRaw<{ id: string; role: string }[]>`
      INSERT INTO users (id, tenant_id, email, role, password_hash)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${email}, 'admin', ${passwordHash})
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = ${passwordHash}, role = 'admin'
      RETURNING id, role
    `
    const u = rows[0]
    if (!u) return reply.code(500).send({ error: 'failed to create user' })
    const token = await reply.jwtSign({ sub: u.id, email, tenantId, role: u.role })
    await appendAuditEvent({
      tenantId, userId: u.id, action: 'auth.setup',
      resource: 'auth:setup', outcome: 'action_executed', metadata: { email },
    }).catch(() => {})
    return reply.send({ token, expiresIn: '24h' })
  })

  // POST /api/auth/login — local email + password login
  // Disable with LOCAL_AUTH_DISABLED=true
  app.post<{ Body: { email: string; password: string; tenantId?: string } }>('/api/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
          tenantId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (process.env['LOCAL_AUTH_DISABLED'] === 'true') {
      return reply.code(404).send({ error: 'local auth disabled' })
    }
    const ip = request.ip
    if (!checkRateLimit(ip)) {
      return reply.code(429).send({ error: 'too many requests — try again in 1 minute' })
    }
    const { email, password } = request.body
    const tenantId = request.body.tenantId ?? process.env['OIDC_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001'

    let user: { id: string; role: string; password_hash: string | null } | null = null
    try {
      const rows = await prisma.$queryRaw<{ id: string; role: string; password_hash: string | null }[]>`
        SELECT id, role, password_hash FROM users
        WHERE tenant_id = ${tenantId}::uuid AND email = ${email} LIMIT 1
      `
      user = rows[0] ?? null
    } catch { /* DB unavailable */ }

    if (!user || !user.password_hash) {
      return reply.code(401).send({ error: 'invalid credentials' })
    }

    const valid = await compare(password, user.password_hash)
    if (!valid) return reply.code(401).send({ error: 'invalid credentials' })

    const token = await reply.jwtSign({ sub: user.id, email, tenantId, role: user.role })
    await appendAuditEvent({
      tenantId, userId: user.id, action: 'auth.local_login',
      resource: 'auth:local', outcome: 'action_executed', metadata: { email },
    }).catch(() => {})
    return reply.send({ token, expiresIn: '24h' })
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
