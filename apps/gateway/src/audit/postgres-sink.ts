import type { AuditEvent, IAuditSink } from '@anway/agent'
import type { PrismaClient } from '@prisma/client'
import { withTenant } from '../db/prisma.js'
import { isValidUUID } from '../utils/validators.js'
import { redactSecrets } from '../utils/redact.js'

const isUUID = isValidUUID

/**
 * Writes audit events to the audit_events table.
 * Awaits the write — must not lose events (V1 audit principle).
 * Errors are passed to the optional onError callback and swallowed.
 */
export class PostgresAuditSink implements IAuditSink {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly onError?: (err: unknown) => void,
  ) {}

  async append(event: AuditEvent): Promise<void> {
    try {
      await withTenant(this.prisma, event.tenantId, (tx) =>
        tx.auditEvent.create({
          data: {
            id: event.id,
            tenant_id: event.tenantId,
            user_id: isUUID(event.userId) ? event.userId : (() => {
              this.onError?.(new Error(`audit: invalid userId "${String(event.userId)}" — storing null`))
              return null
            })(),
            session_id: isUUID(event.sessionId) ? event.sessionId : null,
            event_type: event.eventType,
            // Redact secret-shaped keys before persisting — audit must never store raw creds
            payload: redactSecrets(event.payload) as object,
            created_at: event.createdAt,
          },
        })
      )
    } catch (err: unknown) {
      this.onError?.(err)
      // Swallow — audit failure must not abort user requests
    }
  }
}
