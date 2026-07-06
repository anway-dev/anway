import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { appendAuditEvent } from './audit.js'
import { UUID_RE } from '../utils/validators.js'

// SLACK_APPROVER_MAP: JSON object mapping a Slack user_id to a real Anway
// user UUID, e.g. {"U0123ABC": "5b1c...-uuid"}. Without a real identity
// binding, /anway approve had no way to know WHICH permission level (if any)
// the Slack caller has in Anway — confirmed live via independent review it
// approved any pending gate for any member of the Slack workspace, no role
// check, no separation-of-duties check, using a sentinel decided_by with no
// real identity at all. Every other approval path (HTTP route, chat tool)
// enforces role + SoD against a real Anway user; Slack must too.
function resolveSlackApprover(slackUserId: string): string | null {
  const raw = process.env['SLACK_APPROVER_MAP']
  if (!raw) return null
  try {
    const map = JSON.parse(raw) as Record<string, string>
    return map[slackUserId] ?? null
  } catch {
    return null
  }
}

async function formatIncidentList(tenantId: string, userId: string): Promise<string> {
  const incidents = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ id: string; title: string; severity: string; status: string }>>`
      SELECT id, title, severity, status FROM incidents
      WHERE tenant_id = ${tenantId}::uuid AND status IN ('active', 'investigating')
      ORDER BY created_at DESC LIMIT 10
    `
  ).catch(() => [])

  if (incidents.length === 0) return 'No active incidents. :white_check_mark:'

  return incidents.map((inc, i) =>
    `${i + 1}. *${inc.severity.toUpperCase()}* — ${inc.title} (${inc.status})`
  ).join('\n')
}

async function getServiceStatus(tenantId: string, serviceName: string): Promise<string> {
  const services = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ name: string; metadata: unknown }>>`
      SELECT name, metadata FROM entities
      WHERE tenant_id = ${tenantId}::uuid AND type = 'Service'
      AND (name ILIKE ${'%' + serviceName + '%'} OR metadata->>'description' ILIKE ${'%' + serviceName + '%'})
      LIMIT 5
    `
  ).catch(() => [])

  if (services.length === 0) return `No services found matching "*${serviceName}*".`

  const incidentCounts = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ name: string; count: string }>>`
      SELECT e.name, COUNT(i.id)::text as count
      FROM entities e
      LEFT JOIN incidents i ON i.tenant_id = ${tenantId}::uuid
        AND i.status IN ('active', 'investigating')
        AND i.metadata->>'serviceName' = e.name
      WHERE e.tenant_id = ${tenantId}::uuid AND e.type = 'Service'
        AND (e.name ILIKE ${'%' + serviceName + '%'} OR e.metadata->>'description' ILIKE ${'%' + serviceName + '%'})
      GROUP BY e.name
      LIMIT 5
    `
  ).catch(() => [])

  return services.map(s => {
    const activeIncidents = parseInt(incidentCounts.find(ic => ic.name === s.name)?.count ?? '0', 10)
    const meta = s.metadata as Record<string, unknown> | null
    const status = meta?.['status'] ?? (activeIncidents > 0 ? 'degraded' : 'healthy')
    const extra = activeIncidents > 0 ? ` — ${activeIncidents} active incident(s)` : ''
    return `• *${s.name}*: ${status}${extra}`
  }).join('\n') || `Service "${serviceName}" not found.`
}

function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  try {
    const crypto = require('node:crypto')
    const sigBaseString = `v0:${timestamp}:${body}`
    const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBaseString).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature))
  } catch {
    return false
  }
}

export async function slackCommandRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body.toString('utf-8') : body
      const parsed = Object.fromEntries(new URLSearchParams(rawBody))
      done(null, { ...parsed, __rawBody: rawBody })
    },
  )

  app.post<{ Body: Record<string, string> }>('/api/slack/commands', async (request, reply) => {
    const signingSecret = process.env['SLACK_SIGNING_SECRET']
    // Fail-closed: if SLACK_SIGNING_SECRET is not set, reject all commands
    // rather than letting unauthenticated callers approve gates.
    if (!signingSecret) {
      return reply.code(503).send({ error: 'Slack integration not configured' })
    }

    const timestamp = request.headers['x-slack-request-timestamp'] as string | undefined
    const signature = request.headers['x-slack-signature'] as string | undefined
    if (!timestamp || !signature) {
      return reply.code(401).send({ error: 'missing slack signature headers' })
    }
    // Reject requests older than 5 minutes (replay protection)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return reply.code(401).send({ error: 'slack request expired' })
    }
    const rawBody = ((request.body as Record<string, unknown>)['__rawBody'] as string) ?? ''
    if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
      return reply.code(401).send({ error: 'invalid slack signature' })
    }

    const { command, text, user_id } = request.body ?? {}
    if (command !== '/anway') {
      return reply.send({ response_type: 'ephemeral', text: 'Unknown command.' })
    }

    const trimmed = (text ?? '').trim()
    // Tenant resolved from server-side env only — never from an attacker-controlled header.
    // The Slack team_id (verified by the HMAC above) should map to a tenant; for now
    // ANWAY_WEBHOOK_TENANT is the admin-configured binding.
    const tenantId = process.env['ANWAY_WEBHOOK_TENANT']
      ?? '00000000-0000-0000-0000-000000000001'

    try {
      // /anway incidents
      if (trimmed === 'incidents') {
        const result = await formatIncidentList(tenantId, user_id ?? 'slack-user')
        return reply.send({ response_type: 'ephemeral', text: result })
      }

      // /anway deploy <service> <env>
      if (trimmed.startsWith('deploy ')) {
        const parts = trimmed.split(' ').slice(1)
        if (parts.length < 2) {
          return reply.send({ response_type: 'ephemeral', text: 'Usage: /anway deploy <service> <env>' })
        }
        const [service, env] = parts
        return reply.send({
          response_type: 'ephemeral',
          text: `Deploy of *${service}* to *${env}* initiated. Use \`/anway status ${service}\` to monitor.`,
        })
      }

      // /anway approve <gate-id>
      if (trimmed.startsWith('approve ')) {
        const gateId = trimmed.split(' ')[1]
        if (!gateId || !UUID_RE.test(gateId)) {
          return reply.send({ response_type: 'ephemeral', text: 'Usage: /anway approve <gate-id> (must be a valid UUID)' })
        }
        const slashUserId = (request.body as Record<string, string> | undefined)?.['user_id'] ?? 'slack-unknown'

        const approverId = resolveSlackApprover(slashUserId)
        if (!approverId) {
          return reply.send({ response_type: 'ephemeral', text: 'Your Slack account is not linked to an Anway identity — ask an admin to add you to SLACK_APPROVER_MAP, or approve from the Anway UI.' })
        }
        const approverRows = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ role: string }>>`SELECT role FROM users WHERE id = ${approverId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
        ).catch(() => [])
        const approverRole = approverRows[0]?.role
        if (approverRole !== 'admin' && approverRole !== 'sre') {
          return reply.send({ response_type: 'ephemeral', text: 'Only admin/sre roles may approve gates.' })
        }

        // Separation of duties: same real-identity check every other approval
        // path enforces — the requester cannot approve their own gate.
        const gateRows = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ user_id: string | null }>>`SELECT user_id FROM gate_events WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending' LIMIT 1`
        ).catch(() => [])
        if (gateRows.length === 0) {
          return reply.send({ response_type: 'ephemeral', text: `Gate *${gateId}* not found or already decided.` })
        }
        if (gateRows[0]!.user_id === approverId) {
          return reply.send({ response_type: 'ephemeral', text: 'You cannot approve a gate you requested yourself.' })
        }

        const affected = await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            UPDATE gate_events
            SET status = 'approved', decided_by = ${approverId}::uuid, decided_at = NOW()
            WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
          `
        ).catch(() => 0)
        if (Number(affected) === 0) {
          return reply.send({ response_type: 'ephemeral', text: `Gate *${gateId}* not found or already decided.` })
        }
        await appendAuditEvent({
          tenantId,
          userId: approverId,
          action: 'gate.approve',
          resource: `gate_event:${gateId}`,
          outcome: 'action_executed',
          metadata: { source: 'slack_slash_command', command: '/anway approve', gateId, slackUser: slashUserId },
        }).catch(() => { /* non-blocking */ })
        return reply.send({ response_type: 'ephemeral', text: `Gate *${gateId}* approved.` })
      }

      // /anway status <service>
      if (trimmed.startsWith('status ')) {
        const serviceName = trimmed.split(' ')[1]
        if (!serviceName) {
          return reply.send({ response_type: 'ephemeral', text: 'Usage: /anway status <service>' })
        }
        const result = await getServiceStatus(tenantId, serviceName)
        return reply.send({ response_type: 'ephemeral', text: result })
      }

      // Unknown command
      return reply.send({
        response_type: 'ephemeral',
        text: 'Unknown command. Try: `incidents` | `deploy <svc> <env>` | `approve <gate-id>` | `status <svc>`',
      })
    } catch (err) {
      request.log.error({ err }, 'slack command handler error')
      return reply.send({ response_type: 'ephemeral', text: 'Internal error processing command.' })
    }
  })
}
