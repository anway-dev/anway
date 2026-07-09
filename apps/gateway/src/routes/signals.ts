// Signals inbox + runbook CRUD.
//
// Confirmed via independent review: signal_inbox was WRITE-ONLY — the
// morning brief (cron-monitors.ts) and surface_context (triggers/actions.ts)
// wrote rows that no route and no UI component ever read, making the
// "Proactive Signals inbox" a write-only table. Similarly runbook_steps was
// READ-only: run_runbook consumed it but nothing anywhere could create a
// runbook (no API, no UI, no seed) — the action worked only if someone
// hand-inserted rows with psql.

import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'
import { UUID_RE } from '../utils/validators.js'

const VALID_RUNBOOK_ACTIONS = new Set([
  'notify_oncall', 'notify_channel', 'create_incident', 'open_war_room',
  'surface_context', 'escalate', 'block_deploy_gate',
])

export async function signalsRoutes(app: FastifyInstance) {
  // GET /api/signals — proactive signals inbox (morning briefs, surfaced contexts)
  app.get<{ Querystring: { unreadOnly?: string; limit?: string } }>(
    '/api/signals',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { tenantId } = request.user as { tenantId: string }
      const unreadOnly = request.query.unreadOnly === 'true'
      const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200)
      const rows = await withTenant(prisma, tenantId, (tx) =>
        unreadOnly
          ? tx.$queryRaw<Array<{ id: string; event_type: string; summary: string; source: string; payload: Record<string, unknown>; read_at: Date | null; created_at: Date }>>`
              SELECT id, event_type, summary, source, payload, read_at, created_at FROM signal_inbox
              WHERE tenant_id = ${tenantId}::uuid AND read_at IS NULL
              ORDER BY created_at DESC LIMIT ${limit}`
          : tx.$queryRaw<Array<{ id: string; event_type: string; summary: string; source: string; payload: Record<string, unknown>; read_at: Date | null; created_at: Date }>>`
              SELECT id, event_type, summary, source, payload, read_at, created_at FROM signal_inbox
              WHERE tenant_id = ${tenantId}::uuid
              ORDER BY created_at DESC LIMIT ${limit}`
      ).catch(() => [])
      return rows.map(r => ({
        id: r.id,
        eventType: r.event_type,
        summary: r.summary,
        source: r.source,
        payload: r.payload,
        readAt: r.read_at,
        createdAt: r.created_at,
      }))
    },
  )

  // POST /api/signals/:id/read — mark a signal read
  app.post<{ Params: { id: string } }>(
    '/api/signals/:id/read',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id } = request.params
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
      const affected = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE signal_inbox SET read_at = NOW()
          WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND read_at IS NULL
        `
      ).catch(() => 0)
      if (Number(affected) === 0) return reply.code(404).send({ error: 'not found or already read' })
      return { ok: true }
    },
  )

  // GET /api/runbooks — list runbooks (grouped from runbook_steps)
  app.get('/api/runbooks', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ runbook_name: string; step: number; action_type: string; action_params: Record<string, unknown> }>>`
        SELECT runbook_name, step, action_type, action_params FROM runbook_steps
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY runbook_name, step
      `
    ).catch(() => [])
    const grouped = new Map<string, Array<{ step: number; actionType: string; actionParams: Record<string, unknown> }>>()
    for (const r of rows) {
      const list = grouped.get(r.runbook_name) ?? []
      list.push({ step: r.step, actionType: r.action_type, actionParams: r.action_params })
      grouped.set(r.runbook_name, list)
    }
    return [...grouped.entries()].map(([name, steps]) => ({ name, steps }))
  })

  // PUT /api/runbooks/:name — create/replace a runbook's steps (admin/sre)
  app.put<{ Params: { name: string }; Body: { steps: Array<{ actionType: string; actionParams?: Record<string, unknown> }> } }>(
    '/api/runbooks/:name',
    {
      preHandler: [app.authenticate, requireRole('admin', 'sre')],
      schema: {
        body: {
          type: 'object',
          required: ['steps'],
          properties: {
            steps: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: {
                type: 'object',
                required: ['actionType'],
                additionalProperties: false,
                properties: {
                  actionType: { type: 'string', minLength: 1, maxLength: 64 },
                  actionParams: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const name = request.params.name.trim()
      if (!name || name.length > 100) return reply.code(400).send({ error: 'invalid runbook name' })
      for (const s of request.body.steps) {
        if (!VALID_RUNBOOK_ACTIONS.has(s.actionType)) {
          return reply.code(400).send({ error: `invalid actionType "${s.actionType}". Valid: ${[...VALID_RUNBOOK_ACTIONS].join(', ')}` })
        }
      }
      await withTenant(prisma, tenantId, async (tx) => {
        await tx.$executeRaw`DELETE FROM runbook_steps WHERE tenant_id = ${tenantId}::uuid AND runbook_name = ${name}`
        for (let i = 0; i < request.body.steps.length; i++) {
          const s = request.body.steps[i]!
          await tx.$executeRaw`
            INSERT INTO runbook_steps (tenant_id, runbook_name, step, action_type, action_params)
            VALUES (${tenantId}::uuid, ${name}, ${i + 1}, ${s.actionType}, ${JSON.stringify(s.actionParams ?? {})}::jsonb)
          `
        }
      })
      return { ok: true, name, steps: request.body.steps.length }
    },
  )

  // DELETE /api/runbooks/:name
  app.delete<{ Params: { name: string } }>(
    '/api/runbooks/:name',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const deleted = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`DELETE FROM runbook_steps WHERE tenant_id = ${tenantId}::uuid AND runbook_name = ${request.params.name}`
      ).catch(() => 0)
      if (Number(deleted) === 0) return reply.code(404).send({ error: 'not found' })
      return reply.code(204).send()
    },
  )
}
