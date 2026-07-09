// Polling fallback for ongoing connector sync — covers connectors whose
// webhook registration is unavailable (no ANWAY_PUBLIC_URL, token missing
// admin:org_hook scope, vendor without webhooks). Runs as a durable
// scheduler job (jobs/scheduler.ts), never in-process setInterval.
//
// Confirmed via independent review: nothing polled any vendor for changes
// post-bootstrap — this poller plus webhook-registrar.ts together are the
// "ongoing graph updates" CLAUDE.md's connector contract promises.
//
// v1 scope: GitHub merged-PR polling. Incremental via a per-connector
// cursor persisted in connector_config.sync_state.pollCursor — each cycle
// only fetches PRs merged since the last one, translates them into the
// same durable pr_merged events the webhook receiver emits, and stamps
// last_event_received_at when anything real arrived. Skipped entirely for
// connectors whose webhook is registered (webhookRegisteredAt set) — no
// double-delivery.

import type { RedisClientType } from 'redis'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { decryptJson } from '../utils/crypto.js'
import { publishDurable } from './durable-events.js'
import { stampEventReceived } from './webhook-registrar.js'
import pino from 'pino'

const log = pino({ name: 'connector-poller' })

interface GithubSearchItem {
  number: number
  title: string
  user?: { login?: string }
  pull_request?: { merged_at?: string | null }
  repository_url?: string
}

export async function pollConnectorsOnce(
  pub: Pick<RedisClientType, 'publish'> | null,
): Promise<{ polled: number; eventsEmitted: number }> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; tenant_id: string; credentials_enc: string | null; sync_state: Record<string, unknown>
  }>>`
    SELECT id, tenant_id::text, credentials_enc, sync_state FROM connector_config
    WHERE connector_type = 'github' AND enabled = true AND credentials_enc IS NOT NULL
  `.catch(() => [] as Array<{ id: string; tenant_id: string; credentials_enc: string | null; sync_state: Record<string, unknown> }>)

  let polled = 0
  let eventsEmitted = 0

  for (const row of rows) {
    // Webhook active → vendor pushes events; polling would double-deliver.
    if (row.sync_state?.['webhookRegisteredAt']) continue
    if (!row.credentials_enc) continue

    let creds: Record<string, unknown>
    try {
      creds = decryptJson<Record<string, unknown>>(row.credentials_enc)
    } catch { continue }
    const token = (creds['token'] ?? creds['apiToken']) as string | undefined
    const org = creds['org'] as string | undefined
    if (!token || !org) continue

    const baseUrl = ((creds['baseUrl'] as string | undefined) ?? 'https://api.github.com').replace(/\/$/, '')
    // First cycle starts from "now minus one poll interval" rather than all
    // of history — bootstrap already indexed the past; polling is for the
    // live edge.
    const cursor = (row.sync_state?.['pollCursor'] as string | undefined)
      ?? new Date(Date.now() - 10 * 60_000).toISOString()
    const cycleStartedAt = new Date().toISOString()

    polled++
    try {
      // Search API: merged PRs in this org since the cursor. `merged:>X`
      // uses GitHub's own merge timestamp — no client-side merge check
      // needed, and results are naturally incremental.
      const q = encodeURIComponent(`org:${org} is:pr is:merged merged:>${cursor}`)
      const res = await fetch(`${baseUrl}/search/issues?q=${q}&sort=updated&order=asc&per_page=50`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) {
        log.warn({ tenantId: row.tenant_id, connectorId: row.id, status: res.status }, 'github poll failed')
        continue
      }
      const data = await res.json() as { items?: GithubSearchItem[] }
      const items = data.items ?? []

      for (const item of items) {
        // repository_url: https://api.github.com/repos/{org}/{repo}
        const repo = item.repository_url?.split('/repos/')[1] ?? 'unknown'
        await publishDurable(pub, row.tenant_id, 'pr_merged', {
          type: 'pr_merged',
          tenantId: row.tenant_id,
          repo,
          prNumber: item.number,
          title: item.title,
          ...(item.user?.login ? { author: item.user.login } : {}),
        })
        eventsEmitted++
      }

      if (items.length > 0) await stampEventReceived(row.tenant_id, row.id)

      // Advance the cursor to when THIS cycle started (not to now-after-
      // fetch) — a PR merged during the fetch window lands in the next
      // cycle instead of being skipped.
      await withTenant(prisma, row.tenant_id, (tx) =>
        tx.$executeRaw`
          UPDATE connector_config
          SET sync_state = sync_state || ${JSON.stringify({ pollCursor: cycleStartedAt })}::jsonb
          WHERE id = ${row.id}::uuid AND tenant_id = ${row.tenant_id}::uuid
        `
      ).catch((err) => log.warn({ err, connectorId: row.id }, 'poll cursor update failed'))
    } catch (err) {
      log.warn({ err, tenantId: row.tenant_id, connectorId: row.id }, 'github poll cycle errored')
    }
  }

  if (eventsEmitted > 0) log.info({ polled, eventsEmitted }, 'connector poll cycle complete')
  return { polled, eventsEmitted }
}
