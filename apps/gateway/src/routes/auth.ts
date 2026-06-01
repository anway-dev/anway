import type { FastifyInstance } from 'fastify'

interface TokenBody {
  email: string
  tenantId: string
}

export async function authRoutes(app: FastifyInstance) {
  // Stub: signs a mock JWT for development. Real auth (SAML/OIDC) wired in M7.
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

    const token = await reply.jwtSign({
      sub: 'stub-user-id',
      email,
      tenantId,
      role: 'dev',
    })

    return reply.send({ token, expiresIn: '24h' })
  })
}
