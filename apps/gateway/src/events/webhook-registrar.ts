// Webhook auto-registration — the "afferent nerves" half of ongoing graph
// sync. Confirmed via independent review: no connector ever registered a
// webhook with its vendor; GraphBuilder's pr_merged/deploy_completed/...
// handlers existed but nothing real fed them. CLAUDE.md: "After bootstrap,
// connector registers event subscriptions for ongoing graph updates."
//
// Called from the graph-builder subscriber after a successful bootstrap.
// Requires ANWAY_PUBLIC_URL (the vendor must be able to reach the gateway);
// when unset, registration is skipped with an explicit audit trail and the
// polling fallback (connector-poller.ts) covers the gap instead — degraded,
// visible, never silent.
//
// GitHub: org-level hook via POST /orgs/{org}/hooks (needs admin:org_hook
// scope on the connector token). Idempotent — an existing hook whose
// config.url already points at this connector's receiver is reused, not
// duplicated. A per-connector random secret is generated, stored encrypted
// in connector_config.sync_state, and verified by the receiver route
// (/api/events/github/:connectorId) on every delivery.

import { randomBytes } from 'node:crypto'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { encryptJson } from '../utils/crypto.js'
import { appendAuditEvent } from '../routes/audit.js'
import pino from 'pino'

const log = pino({ name: 'webhook-registrar' })

interface GithubHook {
  id: number
  config?: { url?: string }
}

export async function ensureGithubWebhook(
  tenantId: string,
  connectorId: string,
  creds: Record<string, unknown>,
): Promise<{ registered: boolean; reason?: string }> {
  const publicUrl = process.env['ANWAY_PUBLIC_URL']?.replace(/\/$/, '')
  if (!publicUrl) {
    await appendAuditEvent({
      tenantId, userId: '00000000-0000-0000-0000-000000000000',
      action: 'connector.webhook_registration_skipped', resource: 'github',
      outcome: 'skipped',
      metadata: { connectorId, reason: 'ANWAY_PUBLIC_URL not set — polling fallback active' },
    }).catch(() => {})
    return { registered: false, reason: 'no_public_url' }
  }

  const token = (creds['token'] ?? creds['apiToken']) as string | undefined
  const org = creds['org'] as string | undefined
  const baseUrl = ((creds['baseUrl'] as string | undefined) ?? 'https://api.github.com').replace(/\/$/, '')
  if (!token || !org) return { registered: false, reason: 'missing_credentials' }

  const hookUrl = `${publicUrl}/api/events/github/${connectorId}`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }

  // Idempotency: reuse an existing hook already pointing at this receiver.
  const listRes = await fetch(`${baseUrl}/orgs/${encodeURIComponent(org)}/hooks?per_page=100`, { headers })
  if (!listRes.ok) {
    // 404/403 commonly means the token lacks admin:org_hook — a real, known
    // scope limitation, not an outage. Fall back to polling, visibly.
    await appendAuditEvent({
      tenantId, userId: '00000000-0000-0000-0000-000000000000',
      action: 'connector.webhook_registration_failed', resource: 'github',
      outcome: 'failure',
      metadata: { connectorId, status: listRes.status, hint: 'token may lack admin:org_hook scope — polling fallback active' },
    }).catch(() => {})
    return { registered: false, reason: `list_hooks_http_${listRes.status}` }
  }
  const hooks = await listRes.json() as GithubHook[]
  const existing = Array.isArray(hooks) ? hooks.find(h => h.config?.url === hookUrl) : undefined
  if (existing) {
    await markWebhookRegistered(tenantId, connectorId, existing.id, null)
    return { registered: true }
  }

  const secret = randomBytes(32).toString('hex')
  const createRes = await fetch(`${baseUrl}/orgs/${encodeURIComponent(org)}/hooks`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['pull_request', 'push'],
      config: { url: hookUrl, content_type: 'json', secret },
    }),
  })
  if (!createRes.ok) {
    await appendAuditEvent({
      tenantId, userId: '00000000-0000-0000-0000-000000000000',
      action: 'connector.webhook_registration_failed', resource: 'github',
      outcome: 'failure',
      metadata: { connectorId, status: createRes.status },
    }).catch(() => {})
    return { registered: false, reason: `create_hook_http_${createRes.status}` }
  }
  const created = await createRes.json() as GithubHook
  await markWebhookRegistered(tenantId, connectorId, created.id, secret)
  await appendAuditEvent({
    tenantId, userId: '00000000-0000-0000-0000-000000000000',
    action: 'connector.webhook_registered', resource: 'github',
    outcome: 'success',
    metadata: { connectorId, hookId: created.id, hookUrl },
  }).catch(() => {})
  log.info({ tenantId, connectorId, hookId: created.id }, 'github org webhook registered')
  return { registered: true }
}

async function markWebhookRegistered(
  tenantId: string,
  connectorId: string,
  hookId: number,
  secret: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    webhookHookId: hookId,
    webhookRegisteredAt: new Date().toISOString(),
  }
  // Secret only known at creation time — an existing (reused) hook keeps
  // whatever secret sync_state already holds from when it was created.
  if (secret) patch['webhookSecretEnc'] = encryptJson(secret)
  await withTenant(prisma, tenantId, (tx) =>
    tx.$executeRaw`
      UPDATE connector_config
      SET sync_state = sync_state || ${JSON.stringify(patch)}::jsonb
      WHERE id = ${connectorId}::uuid AND tenant_id = ${tenantId}::uuid
    `
  ).catch((err) => log.warn({ err, connectorId }, 'failed to persist webhook registration state'))
}

/** Stamp last_event_received_at for a connector — event silence becomes visible. */
export async function stampEventReceived(tenantId: string, connectorId: string): Promise<void> {
  await withTenant(prisma, tenantId, (tx) =>
    tx.$executeRaw`
      UPDATE connector_config SET last_event_received_at = NOW()
      WHERE id = ${connectorId}::uuid AND tenant_id = ${tenantId}::uuid
    `
  ).catch(() => {})
}

/** Same, keyed by connector type (for receivers that authenticate per-tenant, not per-connector — e.g. alertmanager). */
export async function stampEventReceivedByType(tenantId: string, connectorType: string): Promise<void> {
  await withTenant(prisma, tenantId, (tx) =>
    tx.$executeRaw`
      UPDATE connector_config SET last_event_received_at = NOW()
      WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${connectorType} AND enabled = true
    `
  ).catch(() => {})
}
