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
    } catch (err) {
      reply.send(err)
    }
  })
})
