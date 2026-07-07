import type { FastifyRequest, FastifyReply } from 'fastify'
import { appendAuditEvent } from '../routes/audit.js'

type Role = 'admin' | 'sre' | 'dev' | 'pm' | 'ba'

// Confirmed live via direct product verification: a real RBAC block (dev-role
// token hitting an admin-only route) produced a correct 403 but ZERO audit
// trail entry — CLAUDE.md's Audit System documents "every hard block (access
// denied)" as immutably logged, and this shared middleware is the enforcement
// point for the large majority of admin/role-gated routes in the gateway.
export function requireRole(...allowed: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { tenantId?: string; sub?: string; role?: string } | undefined
    const role = user?.role as Role | undefined
    if (!role || !allowed.includes(role)) {
      if (user?.tenantId) {
        await appendAuditEvent({
          tenantId: user.tenantId,
          ...(user.sub ? { userId: user.sub } : {}),
          action: 'access_denied',
          resource: request.url,
          outcome: 'blocked',
          metadata: { method: request.method, required: allowed, actual: role ?? 'none' },
        }).catch(() => {})
      }
      return reply.code(403).send({ error: 'insufficient role', required: allowed, actual: role ?? 'none' })
    }
  }
}

// Same audit gap as requireRole above, for the routes that inline their own
// `role !== 'admin'` check instead of using the requireRole preHandler.
// Returns true if the request was denied (and already replied to) — callers
// do `if (await auditAndDenyIfNotAdmin(request, reply)) return`.
export async function auditAndDenyIfNotAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  errorBody: Record<string, unknown> = { error: 'admin role required' },
): Promise<boolean> {
  const user = request.user as { tenantId?: string; sub?: string; role?: string } | undefined
  if (user?.role === 'admin') return false
  if (user?.tenantId) {
    await appendAuditEvent({
      tenantId: user.tenantId,
      ...(user.sub ? { userId: user.sub } : {}),
      action: 'access_denied',
      resource: request.url,
      outcome: 'blocked',
      metadata: { method: request.method, required: ['admin'], actual: user?.role ?? 'none' },
    }).catch(() => {})
  }
  await reply.code(403).send(errorBody)
  return true
}
