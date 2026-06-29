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
  }, async (request, reply) => {
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
      if (isNaN(cursorDate.getTime()) || (cursorId !== null && !/^[0-9a-f-]{36}$/.test(cursorId))) {
        return reply.code(400).send({ error: 'invalid cursor' })
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
      service: extractService(r.description),
      timestamp: timeAgo(r.created_at),
      triageStatus: (r.status === 'active' || r.status === 'investigating') ? 'triaging' : 'pending' as 'auto_triaged' | 'triaging' | 'pending' | 'escalated',
      triageSummary: r.suggested_root_cause ?? undefined,
      orchestratorQuery: buildOrchestratorQuery(r.title, extractService(r.description), r.description),
    })),
      nextCursor: hasMore && last ? `${last.created_at.toISOString()},${last.id}` : null,
    }
  })
}

// Incident description is stored as "svc — annotation text" (events.ts line 172).
// If no separator, the whole string is the annotation (no service was in the labels).
function extractService(desc: string | null): string {
  if (!desc) return 'unknown'
  const sepIdx = desc.indexOf(' — ')
  if (sepIdx > 0) return desc.slice(0, sepIdx).trim()
  return 'unknown'
}

// Build a rich query so the orchestrator can resolve the service via graph lookup
// instead of asking "which service?" for every alert-triggered investigation.
function buildOrchestratorQuery(title: string, service: string, desc: string | null): string {
  const annotation = desc ? desc.replace(/^[^—]*—\s*/, '').trim() : ''
  if (service !== 'unknown') {
    const annotationPart = annotation ? ` ${annotation}.` : ''
    return `Investigate the "${title}" alert on service ${service}.${annotationPart} What is the root cause?`
  }
  return `Investigate the "${title}" alert. What is the root cause?`
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
