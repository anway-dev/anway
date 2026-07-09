// Native GitHub webhook receiver — /api/events/github/:connectorId
//
// Confirmed via independent review: the existing /api/events/pr-merged route
// expects Anway's own payload shape ({repo, prNumber, ...}) — a real GitHub
// webhook delivery (X-GitHub-Event: pull_request, GitHub's own body shape)
// would fail its schema outright, so pointing GitHub at the gateway was
// never actually possible. This route accepts GitHub's real delivery
// format, verifies the per-connector HMAC secret generated at registration
// time (webhook-registrar.ts), resolves the tenant from the connectorId in
// the URL (multi-tenant safe — no shared global secret), and translates
// merged pull_request events into the internal durable pr_merged event the
// GraphBuilder already consumes.
//
// Registered from INSIDE eventRoutes' plugin scope (events.ts) — the raw
// body capture needed for HMAC (rawBodyString) comes from that plugin's
// content-type parser and is encapsulated to it.

import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { RedisClientType } from 'redis'
import { prisma } from '../db/client.js'
import { decryptJson } from '../utils/crypto.js'
import { UUID_RE } from '../utils/validators.js'
import { publishDurable } from '../events/durable-events.js'
import { stampEventReceived } from '../events/webhook-registrar.js'

interface GithubPullRequestEvent {
  action?: string
  pull_request?: {
    number?: number
    title?: string
    merged?: boolean
    merge_commit_sha?: string
    user?: { login?: string }
  }
  repository?: { full_name?: string }
}

export function registerGithubWebhookRoute(
  app: FastifyInstance,
  getPub: () => Promise<RedisClientType | null>,
) {
  app.post<{ Params: { connectorId: string } }>(
    '/api/events/github/:connectorId',
    async (request, reply) => {
      const { connectorId } = request.params
      if (!UUID_RE.test(connectorId)) return reply.code(404).send({ error: 'not found' })

      // Resolve tenant + secret by connectorId. Same direct (service-client)
      // connector_config read pattern as webhookTenantFor above in events.ts —
      // this lookup is what ESTABLISHES which tenant the delivery belongs
      // to, so it can't itself run tenant-scoped.
      const rows = await prisma.$queryRaw<Array<{ tenant_id: string; sync_state: Record<string, unknown> }>>`
        SELECT tenant_id::text, sync_state FROM connector_config
        WHERE id = ${connectorId}::uuid AND connector_type = 'github' AND enabled = true
        LIMIT 1
      `.catch(() => [] as Array<{ tenant_id: string; sync_state: Record<string, unknown> }>)
      if (rows.length === 0) return reply.code(404).send({ error: 'not found' })
      const tenantId = rows[0]!.tenant_id
      const secretEnc = rows[0]!.sync_state?.['webhookSecretEnc'] as string | undefined
      if (!secretEnc) {
        // No secret on record — this connector never completed webhook
        // registration; reject rather than accept unauthenticated deliveries.
        return reply.code(401).send({ error: 'webhook not registered' })
      }

      const secret = decryptJson<string>(secretEnc)
      const signature = request.headers['x-hub-signature-256'] as string | undefined
      const rawBuf = (request as unknown as { rawBodyString?: Buffer }).rawBodyString
      if (!signature || !rawBuf) return reply.code(401).send({ error: 'missing signature' })
      const expected = 'sha256=' + createHmac('sha256', secret).update(rawBuf).digest('hex')
      const sigBuf = Buffer.from(signature)
      const expBuf = Buffer.from(expected)
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return reply.code(401).send({ error: 'invalid signature' })
      }

      await stampEventReceived(tenantId, connectorId)

      const ghEvent = request.headers['x-github-event'] as string | undefined
      if (ghEvent === 'ping') return { ok: true, pong: true }

      if (ghEvent === 'pull_request') {
        const body = request.body as GithubPullRequestEvent
        if (body.action === 'closed' && body.pull_request?.merged === true) {
          const pub = await getPub()
          await publishDurable(pub, tenantId, 'pr_merged', {
            type: 'pr_merged',
            tenantId,
            repo: body.repository?.full_name ?? 'unknown',
            ...(body.pull_request.number != null ? { prNumber: body.pull_request.number } : {}),
            ...(body.pull_request.title ? { title: body.pull_request.title } : {}),
            ...(body.pull_request.user?.login ? { author: body.pull_request.user.login } : {}),
            ...(body.pull_request.merge_commit_sha ? { sha: body.pull_request.merge_commit_sha } : {}),
          })
          return { ok: true, event: 'pr_merged' }
        }
        return { ok: true, ignored: body.action }
      }

      // push and anything else: acknowledged (stamped as liveness above) but
      // not yet translated into an internal event.
      return { ok: true, ignored: ghEvent ?? 'unknown' }
    },
  )
}
