import type { AuditEvent, IAuditSink } from '@anvay/agent'
import type { PrismaClient } from '@prisma/client'
import { withTenant } from '../db/prisma.js'

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/**
 * Writes audit events to the audit_events table.
 * Fire-and-forget: never awaited on the critical path — <1ms perceived latency.
 * Errors are passed to the optional onError callback (e.g. pino logger).
 */
export class PostgresAuditSink implements IAuditSink {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly onError?: (err: unknown) => void,
  ) {}

  append(event: AuditEvent): Promise<void> {
    void withTenant(this.prisma, event.tenantId, (tx) =>
      tx.auditEvent.create({
        data: {
          id: event.id,
          tenant_id: event.tenantId,
          user_id: isUUID(event.userId) ? event.userId : null,
          session_id: isUUID(event.sessionId) ? event.sessionId : null,
          event_type: event.eventType,
          payload: event.payload as object,
          created_at: event.createdAt,
        },
      })
    ).catch((err: unknown) => {
      this.onError?.(err)
    })
    return Promise.resolve()
  }
}
