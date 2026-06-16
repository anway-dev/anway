import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

interface LiveAlert {
  id: string
  kind: 'alert' | 'ticket' | 'metric' | 'customer' | 'ci' | 'error'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  source: string
  sourceIcon: string
  sourceColor: string
  service: string
  timestamp: string
  triageStatus: 'auto_triaged' | 'triaging' | 'pending' | 'escalated'
  triageSummary?: string
  confidence?: number
  gateId?: string
  gateStatus?: 'pending_approval' | 'auto_approved'
  orchestratorQuery: string
  branch?: string
  commitSha?: string
  runUrl?: string
  errorCount?: number
  firstSeen?: string
}

interface IncidentRow {
  id: string
  title: string
  severity: string
  status: string
  description: string | null
  suggested_root_cause: string | null
  created_at: Date
}

export async function alertRoutes(app: FastifyInstance) {
  app.get('/api/alerts', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const { cursor, limit: limitStr } = request.query as { cursor?: string; limit?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)

    let cursorDate: Date | null = null
    let cursorId: string | null = null
    if (cursor) {
      const sepIdx = cursor.lastIndexOf(',')
      if (sepIdx > 0) {
        cursorDate = new Date(cursor.slice(0, sepIdx))
        cursorId = cursor.slice(sepIdx + 1)
      } else {
        cursorDate = new Date(cursor)
      }
    }

    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<IncidentRow[]>`
        SELECT id, title, severity, status, description, suggested_root_cause, created_at
        FROM incidents
        WHERE tenant_id = ${tenantId}::uuid
        ${cursorDate && cursorId
          ? Prisma.sql`AND (created_at, id) < (${cursorDate}, ${cursorId}::uuid)`
          : cursorDate
            ? Prisma.sql`AND created_at < ${cursorDate}`
            : Prisma.sql``}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `
    ).catch(() => [] as IncidentRow[])

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    const last = data[data.length - 1]

    return {
      data: data.map(r => ({
      id: r.id,
      kind: 'alert' as const,
      severity: (r.severity === 'critical' || r.severity === 'high' || r.severity === 'medium' || r.severity === 'low') ? r.severity : 'medium' as 'critical' | 'high' | 'medium' | 'low',
      title: r.title,
      source: 'Incidents',
      sourceIcon: 'IN',
      sourceColor: '#10b981',
      service: r.description?.split('\n')[0]?.trim() || 'unknown',
      timestamp: timeAgo(r.created_at),
      triageStatus: (r.status === 'active' || r.status === 'investigating') ? 'triaging' : 'pending' as 'auto_triaged' | 'triaging' | 'pending' | 'escalated',
      triageSummary: r.suggested_root_cause ?? undefined,
      orchestratorQuery: `Explain: ${r.title}`,
    })),
      nextCursor: hasMore && last ? `${last.created_at.toISOString()},${last.id}` : null,
    }
  })
}

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`
  return `${Math.floor(hr / 24)}d ago`
}
