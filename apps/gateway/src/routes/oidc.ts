import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import '@fastify/cookie'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:8500'

function webRedirectWithToken(reply: FastifyReply, token: string) {
  // Pass token via hash fragment — never hits server logs or Referer headers
  return reply.redirect(`${WEB_URL}/#token=${encodeURIComponent(token)}`)
}

function getGoogleConfig() {
  const clientId = process.env['GOOGLE_CLIENT_ID']
  if (!clientId) return null
  return {
    issuerUrl: 'https://accounts.google.com',
    clientId,
    clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
    redirectUri: process.env['GOOGLE_REDIRECT_URI'] ?? `${WEB_URL}/api/auth/google/callback`,
    tenantId: process.env['OIDC_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001',
  }
}

function getGithubConfig() {
  const clientId = process.env['GITHUB_CLIENT_ID']
  if (!clientId) return null
  return {
    clientId,
    clientSecret: process.env['GITHUB_CLIENT_SECRET'] ?? '',
    redirectUri: process.env['GITHUB_REDIRECT_URI'] ?? `${WEB_URL}/api/auth/github/callback`,
    tenantId: process.env['OIDC_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001',
  }
}

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

async function upsertOAuthUser(tenantId: string, email: string, sub: string): Promise<{ id: string | null; role: string }> {
  try {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ id: string; role: string }[]>`
        INSERT INTO users (id, tenant_id, email, role, oidc_sub)
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${email}, 'dev', ${sub})
        ON CONFLICT (tenant_id, email) DO UPDATE SET oidc_sub = EXCLUDED.oidc_sub
        RETURNING id, role
      `
    )
    return { id: rows[0]?.id ?? null, role: rows[0]?.role ?? 'dev' }
  } catch {
    try {
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ id: string; role: string }[]>`
          SELECT id, role FROM users WHERE tenant_id = ${tenantId}::uuid AND email = ${email} LIMIT 1
        `
      )
      return { id: rows[0]?.id ?? null, role: rows[0]?.role ?? 'dev' }
    } catch {
      return { id: null, role: 'dev' }
    }
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
      if (emailVerified !== true) {
        return reply.code(403).send({ error: 'OIDC login requires a verified email address' })
      }
      const email = (claims['email'] as string) ?? `${claims['sub']}@oidc.local`
      const sub = (claims['sub'] as string) ?? 'unknown'
      const tenantId = decoded.tenantId || cfg.tenantId

      const { id: userId, role: userRole } = await upsertOAuthUser(tenantId, email, sub)

      if (!userId) {
        request.log.error({ sub, email }, 'user upsert failed during OIDC callback — refusing to mint token')
        return reply.code(500).send({ error: 'authentication failed' })
      }

      const token = app.jwt.sign({ sub: userId, email, tenantId, role: userRole })

      reply.clearCookie('oidc_state', { path: '/auth/oidc' })
      return webRedirectWithToken(reply, token)
    } catch (err) {
      request.log.error({ err }, 'OIDC callback failed')
      return reply.code(500).send({ error: 'OIDC callback failed' })
    }
  })

  // ── Google OAuth (reuses OIDC flow with Google's discovery URL) ──────────
  app.get('/api/auth/google', async (request, reply) => {
    const cfg = getGoogleConfig()
    if (!cfg) return reply.code(404).send({ error: 'Google OAuth not configured — set GOOGLE_CLIENT_ID' })
    try {
      const { discovery, buildAuthorizationUrl, randomPKCECodeVerifier, calculatePKCECodeChallenge, randomState, ClientSecretPost } = await import('openid-client')
      const config = await discovery(new URL(cfg.issuerUrl), cfg.clientId, undefined, ClientSecretPost(cfg.clientSecret))
      const codeVerifier = randomPKCECodeVerifier()
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier)
      const state = randomState()
      const stateToken = (app.jwt as { sign(p: Record<string, unknown>): string }).sign({ codeVerifier, state, tenantId: cfg.tenantId, provider: 'google' })
      reply.setCookie('oidc_state', stateToken, { path: '/api/auth', httpOnly: true, secure: process.env['NODE_ENV'] === 'production', sameSite: 'lax', maxAge: 600 })
      return reply.redirect(buildAuthorizationUrl(config, { redirect_uri: cfg.redirectUri, scope: 'openid email profile', code_challenge: codeChallenge, code_challenge_method: 'S256', state }).href)
    } catch (err) {
      request.log.error({ err }, 'Google OAuth initiation failed')
      return reply.code(500).send({ error: 'Google OAuth failed' })
    }
  })

  app.get('/api/auth/google/callback', async (request, reply) => {
    const cfg = getGoogleConfig()
    if (!cfg) return reply.code(404).send({ error: 'Google OAuth not configured' })
    const stateCookie = request.cookies['oidc_state']
    if (!stateCookie) return reply.code(400).send({ error: 'missing state' })
    interface SP { codeVerifier: string; state: string; tenantId: string }
    let decoded: SP
    try { decoded = app.jwt.verify<SP>(stateCookie) } catch { return reply.code(400).send({ error: 'invalid state' }) }
    const q = request.query as { code?: string; state?: string; error?: string }
    if (q.error) return reply.code(400).send({ error: q.error })
    if (!q.code || q.state !== decoded.state) return reply.code(400).send({ error: 'invalid callback' })
    try {
      const { discovery, authorizationCodeGrant, ClientSecretPost } = await import('openid-client')
      const config = await discovery(new URL(cfg.issuerUrl), cfg.clientId, undefined, ClientSecretPost(cfg.clientSecret))
      const tokens = await authorizationCodeGrant(config, new URL(request.url, `${request.protocol}://${request.hostname}`), { pkceCodeVerifier: decoded.codeVerifier, expectedState: decoded.state })
      const claims = tokens.claims()
      if (!claims || claims['email_verified'] !== true) return reply.code(403).send({ error: 'email not verified' })
      const email = claims['email'] as string
      const sub = claims['sub'] as string
      const { id: userId, role } = await upsertOAuthUser(decoded.tenantId, email, sub)
      if (!userId) return reply.code(500).send({ error: 'user upsert failed' })
      const token = app.jwt.sign({ sub: userId, email, tenantId: decoded.tenantId, role })
      reply.clearCookie('oidc_state', { path: '/api/auth' })
      return webRedirectWithToken(reply, token)
    } catch (err) {
      request.log.error({ err }, 'Google callback failed')
      return reply.code(500).send({ error: 'Google callback failed' })
    }
  })

  // ── GitHub OAuth ──────────────────────────────────────────────────────────
  app.get('/api/auth/github', async (request, reply) => {
    const cfg = getGithubConfig()
    if (!cfg) return reply.code(404).send({ error: 'GitHub OAuth not configured — set GITHUB_CLIENT_ID' })
    const state = Math.random().toString(36).slice(2)
    const stateToken = (app.jwt as { sign(p: Record<string, unknown>): string }).sign({ state, tenantId: cfg.tenantId, provider: 'github' })
    reply.setCookie('oidc_state', stateToken, { path: '/api/auth', httpOnly: true, secure: process.env['NODE_ENV'] === 'production', sameSite: 'lax', maxAge: 600 })
    const url = `https://github.com/login/oauth/authorize?client_id=${cfg.clientId}&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&scope=read:user,user:email&state=${state}`
    return reply.redirect(url)
  })

  app.get('/api/auth/github/callback', async (request, reply) => {
    const cfg = getGithubConfig()
    if (!cfg) return reply.code(404).send({ error: 'GitHub OAuth not configured' })
    const stateCookie = request.cookies['oidc_state']
    if (!stateCookie) return reply.code(400).send({ error: 'missing state' })
    interface SP { state: string; tenantId: string }
    let decoded: SP
    try { decoded = app.jwt.verify<SP>(stateCookie) } catch { return reply.code(400).send({ error: 'invalid state' }) }
    const q = request.query as { code?: string; state?: string; error?: string }
    if (q.error || !q.code || q.state !== decoded.state) return reply.code(400).send({ error: 'invalid callback' })
    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: q.code, redirect_uri: cfg.redirectUri }),
      })
      const tokenData = await tokenRes.json() as { access_token?: string; error?: string }
      if (!tokenData.access_token) return reply.code(401).send({ error: tokenData.error ?? 'GitHub token exchange failed' })

      const [userRes, emailsRes] = await Promise.all([
        fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json' } }),
        fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json' } }),
      ])
      const ghUser = await userRes.json() as { id: number; login: string }
      const ghEmails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>
      const primary = ghEmails.find(e => e.primary && e.verified)
      if (!primary) return reply.code(403).send({ error: 'no verified primary email on GitHub account' })

      const { id: userId, role } = await upsertOAuthUser(decoded.tenantId, primary.email, `github:${ghUser.id}`)
      if (!userId) return reply.code(500).send({ error: 'user upsert failed' })
      const token = app.jwt.sign({ sub: userId, email: primary.email, tenantId: decoded.tenantId, role })
      reply.clearCookie('oidc_state', { path: '/api/auth' })
      return webRedirectWithToken(reply, token)
    } catch (err) {
      request.log.error({ err }, 'GitHub callback failed')
      return reply.code(500).send({ error: 'GitHub callback failed' })
    }
  })
}
