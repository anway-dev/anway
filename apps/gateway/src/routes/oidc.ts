import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import '@fastify/cookie'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

interface OidcEnv {
  issuerUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  tenantId: string
}

function getOidcConfig(): OidcEnv | null {
  const issuerUrl = process.env['OIDC_ISSUER_URL']
  if (!issuerUrl) return null
  const clientId = process.env['OIDC_CLIENT_ID']
  const clientSecret = process.env['OIDC_CLIENT_SECRET']
  const redirectUri = process.env['OIDC_REDIRECT_URI']
  if (!clientId || !clientSecret || !redirectUri) return null
  return {
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri,
    tenantId: process.env['OIDC_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001',
  }
}

export async function oidcRoutes(app: FastifyInstance) {
  app.get('/auth/oidc/status', async (_request, reply) => {
    const cfg = getOidcConfig()
    if (!cfg) return reply.send({ configured: false })
    return reply.send({ configured: true, issuer: cfg.issuerUrl })
  })

  app.get('/auth/oidc/login', async (request, reply) => {
    const cfg = getOidcConfig()
    if (!cfg) return reply.code(404).send({ error: 'OIDC not configured — OIDC_ISSUER_URL not set' })

    try {
      const {
        discovery,
        buildAuthorizationUrl,
        randomPKCECodeVerifier,
        calculatePKCECodeChallenge,
        randomState,
        ClientSecretPost,
      } = await import('openid-client')

      const server = new URL(cfg.issuerUrl)
      const clientAuth = ClientSecretPost(cfg.clientSecret)
      const config = await discovery(server, cfg.clientId, undefined, clientAuth)

      const codeVerifier = randomPKCECodeVerifier()
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier)
      const state = randomState()

      // Store code_verifier and state in a short-lived cookie (signed by fastify)
      const stateToken = (app.jwt as { sign(payload: Record<string, unknown>): string }).sign({
        codeVerifier,
        state,
        tenantId: cfg.tenantId,
      })

      reply.setCookie('oidc_state', stateToken, {
        path: '/auth/oidc',
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes
      })

      const authUrl = buildAuthorizationUrl(config, {
        redirect_uri: cfg.redirectUri,
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      })

      return reply.redirect(authUrl.href)
    } catch (err) {
      request.log.error({ err }, 'OIDC login failed')
      return reply.code(500).send({ error: 'OIDC login failed' })
    }
  })

  app.get('/auth/oidc/callback', async (request, reply) => {
    const cfg = getOidcConfig()
    if (!cfg) return reply.code(404).send({ error: 'OIDC not configured' })

    const stateCookie = request.cookies['oidc_state']
    if (!stateCookie) return reply.code(400).send({ error: 'missing state cookie' })

    interface StatePayload { codeVerifier: string; state: string; tenantId: string }
    let decoded: StatePayload
    try {
      decoded = app.jwt.verify<StatePayload>(stateCookie)
    } catch {
      return reply.code(400).send({ error: 'invalid or expired state cookie' })
    }

    const query = request.query as { code?: string; state?: string; error?: string }
    if (query.error) return reply.code(400).send({ error: `OIDC error: ${query.error}` })
    if (!query.code) return reply.code(400).send({ error: 'missing authorization code' })
    if (query.state !== decoded.state) return reply.code(400).send({ error: 'state mismatch' })

    try {
      const {
        discovery,
        authorizationCodeGrant,
        ClientSecretPost,
      } = await import('openid-client')

      const server = new URL(cfg.issuerUrl)
      const clientAuth = ClientSecretPost(cfg.clientSecret)
      const config = await discovery(server, cfg.clientId, undefined, clientAuth)

      const currentUrl = new URL(request.url, `${request.protocol}://${request.hostname}`)
      const tokens = await authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: decoded.codeVerifier,
        expectedState: decoded.state,
      })

      const claims = tokens.claims()
      if (!claims) return reply.code(500).send({ error: 'OIDC callback failed — no claims in token' })
      // Require email_verified to prevent account takeover via unverified email assertion
      const emailVerified = claims['email_verified']
      if (emailVerified === false) {
        return reply.code(403).send({ error: 'OIDC login requires a verified email address' })
      }
      const email = (claims['email'] as string) ?? `${claims['sub']}@oidc.local`
      const sub = (claims['sub'] as string) ?? 'unknown'
      const tenantId = decoded.tenantId || cfg.tenantId

      // Upsert user — fall back to no oidc_sub column if migration not applied
      let userId: string | null = null
      let userRole: string = 'dev'
      try {
        const rows = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<{ id: string; role: string }[]>`
            INSERT INTO users (id, tenant_id, email, role, oidc_sub)
            VALUES (gen_random_uuid(), ${tenantId}::uuid, ${email}, 'dev', ${sub})
            ON CONFLICT (tenant_id, email) DO UPDATE SET oidc_sub = EXCLUDED.oidc_sub
            RETURNING id, role
          `
        )
        userId = rows[0]?.id ?? null
        userRole = rows[0]?.role ?? 'dev'
      } catch {
        try {
          const rows = await withTenant(prisma, tenantId, (tx) =>
            tx.$queryRaw<{ id: string; role: string }[]>`
              INSERT INTO users (id, tenant_id, email, role)
              VALUES (gen_random_uuid(), ${tenantId}::uuid, ${email}, 'dev')
              ON CONFLICT (tenant_id, email) DO NOTHING
              RETURNING id, role
            `
          )
          if (rows.length === 0) {
            const existing = await withTenant(prisma, tenantId, (tx) =>
              tx.$queryRaw<{ id: string; role: string }[]>`SELECT id, role FROM users WHERE tenant_id = ${tenantId}::uuid AND email = ${email} LIMIT 1`
            )
            userId = existing[0]?.id ?? null
            userRole = existing[0]?.role ?? 'dev'
          } else {
            userId = rows[0]!.id
            userRole = rows[0]!.role
          }
        } catch { /* fall through */ }
      }

      // Ensure tenant exists
      try {
        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`INSERT INTO tenants (id, name, slug, plan) VALUES (${tenantId}::uuid, 'OIDC Tenant', 'oidc', 'tier1') ON CONFLICT (id) DO NOTHING`
        ).catch(() => {})
      } catch { /* tenant table may differ */ }

      if (!userId) {
        request.log.error({ sub, email }, 'user upsert failed during OIDC callback — refusing to mint token')
        return reply.code(500).send({ error: 'authentication failed' })
      }

      const token = app.jwt.sign({
        sub: userId,
        email,
        tenantId,
        role: userRole,
      })

      reply.clearCookie('oidc_state', { path: '/auth/oidc' })
      // Set token as httpOnly cookie — never embed in URL (leaks to logs/history/Referer)
      reply.setCookie('anvay_token', token, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 24 * 60 * 60,
      })
      return reply.redirect('/')
    } catch (err) {
      request.log.error({ err }, 'OIDC callback failed')
      return reply.code(500).send({ error: 'OIDC callback failed' })
    }
  })
}
