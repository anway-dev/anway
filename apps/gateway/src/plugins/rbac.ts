import type { FastifyRequest, FastifyReply } from 'fastify'

type Role = 'admin' | 'sre' | 'dev' | 'pm' | 'ba'

export function requireRole(...allowed: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = (request.user as { role?: string })?.role as Role | undefined
    if (!role || !allowed.includes(role)) {
      return reply.code(403).send({ error: 'insufficient role', required: allowed, actual: role ?? 'none' })
    }
  }
}
