import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      email: string
      tenantId: string
      role: string
    }
    user: {
      sub: string
      email: string
      tenantId: string
      role: string
      env: string  // active environment — from X-Anway-Env header, defaults to 'prod'
    }
  }
}

export default fp(async function jwtPlugin(app: FastifyInstance) {
  const privateKey = process.env.JWT_PRIVATE_KEY
  const publicKey = process.env.JWT_PUBLIC_KEY
  const secret = process.env.JWT_SECRET

  if (!privateKey && !secret) {
    throw new Error('JWT_SECRET or JWT_PRIVATE_KEY must be set')
  }

  // Production hardening: refuse to boot with a weak or known-default HS256
  // secret. These are the literal defaults shipped in this repo's own
  // .env.example files — a prod deploy that never rotated them would mint
  // trivially forgeable session tokens. Fail closed at boot, matching
  // assertEncryptionKey()'s posture for ANWAY_ENCRYPTION_KEY.
  if (process.env['NODE_ENV'] === 'production' && !privateKey && secret) {
    const KNOWN_DEFAULTS = new Set([
      'dev-secret-change-in-production',
      'change-me-to-a-random-secret-at-least-32-chars',
      'ci-test-secret-not-for-real-use-32chars',
      'test-secret',
    ])
    if (KNOWN_DEFAULTS.has(secret)) {
      throw new Error('JWT_SECRET is a known default value — set a unique random secret for production')
    }
    if (secret.length < 32) {
      throw new Error(`JWT_SECRET must be at least 32 characters in production (got ${secret.length})`)
    }
  }

  await app.register(jwt, {
    secret:
      privateKey && publicKey
        ? { private: privateKey, public: publicKey }
        : (secret as string),
    sign: {
      algorithm: privateKey ? 'RS256' : 'HS256',
      expiresIn: '24h',
    },
  })

  app.decorate('authenticate', async function authenticateRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      await request.jwtVerify()
      // Inject active env from header — lowercase slug, alphanumeric+hyphen only
      const rawEnv = request.headers['x-anway-env']
      const envHeader = typeof rawEnv === 'string' ? rawEnv.toLowerCase().replace(/[^a-z0-9-]/g, '') : ''
      ;(request.user as { env: string }).env = envHeader || 'prod'
    } catch (err) {
      reply.send(err)
    }
  })
})
