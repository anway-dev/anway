// Durable domain-event publish/consume helpers (outbox pattern).
//
// Confirmed via independent review: every domain event rode fire-and-forget
// Redis pub/sub — a gateway restart mid-event permanently lost it, and with
// multiple gateway replicas every replica processed every message. See
// migrations/0051_event_log for the schema and full rationale.
//
// publishDurable: INSERT into event_log first (durable record), then publish
// to Redis with __eventLogId attached. If the INSERT fails (DB briefly
// down), still publishes — degrading to exactly the old at-most-once
// behavior rather than dropping the event entirely.
//
// claimEvent: exactly-one-replica claim via INSERT ... ON CONFLICT DO
// NOTHING on (event_id, consumer). A legacy message with no __eventLogId
// (or a claim-table failure) returns true — process it, since skipping on
// bookkeeping failure would trade a rare duplicate for a lost event, and
// every event handler in this codebase is idempotent by contract
// (GraphBuilder upserts merge; IncidentService create is the one
// at-least-once duplicate risk and existed before this change).
//
// replayUnconsumedEvents: re-publishes rows past a grace period that no
// consumer has claimed, bounded by replay_count — heals a crash between
// INSERT and publish, or a subscriber that was down when the event fired.

import type { RedisClientType } from 'redis'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import pino from 'pino'

const log = pino({ name: 'durable-events' })

const MAX_REPLAYS = 5
const REPLAY_GRACE_SECONDS = 60
const REPLAY_MAX_AGE_HOURS = 24

export async function publishDurable(
  pub: Pick<RedisClientType, 'publish'> | null,
  tenantId: string,
  channel: string,
  payload: Record<string, unknown>,
): Promise<void> {
  let eventLogId: string | null = null
  try {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO event_log (tenant_id, channel, payload)
        VALUES (${tenantId}::uuid, ${channel}, ${JSON.stringify(payload)}::jsonb)
        RETURNING id
      `
    )
    eventLogId = rows[0]?.id ?? null
  } catch (err) {
    log.warn({ err, channel, tenantId }, 'event_log outbox insert failed — publishing without durability')
  }

  if (!pub) return
  const message = JSON.stringify(eventLogId ? { ...payload, __eventLogId: eventLogId } : payload)
  try {
    await pub.publish(channel, message)
  } catch (err) {
    // Insert succeeded but publish failed → replayer picks it up. Insert
    // AND publish both failing is the pre-existing total-loss case.
    log.warn({ err, channel, tenantId, eventLogId }, 'redis publish failed — replayer will retry if outbox row exists')
  }
}

/**
 * Returns true if this replica should process the event. Exactly one
 * replica per consumer name wins the claim for a given event.
 */
export async function claimEvent(
  eventLogId: string | undefined,
  tenantId: string,
  consumer: string,
): Promise<boolean> {
  if (!eventLogId) return true // legacy/ephemeral message — no dedupe possible
  try {
    const claimed = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        INSERT INTO event_consumptions (event_id, tenant_id, consumer)
        VALUES (${eventLogId}::uuid, ${tenantId}::uuid, ${consumer})
        ON CONFLICT (event_id, consumer) DO NOTHING
      `
    )
    return Number(claimed) > 0
  } catch (err) {
    // Bookkeeping failure must not drop the event — handlers are idempotent.
    log.warn({ err, eventLogId, consumer }, 'event claim failed — processing anyway')
    return true
  }
}

// Which consumers are expected to claim each channel. Replay fires when ANY
// expected consumer is missing its claim — not only when zero exist —
// because three subscriber processes share several channels (e.g.
// incident_created feeds graph-builder + trigger-engine +
// incident-subscriber): if one was down while the others claimed, a
// zero-consumptions heuristic would never heal the one that missed it.
// Re-published events reach every subscriber again; the ones that already
// claimed dedupe via claimEvent, the missing one processes.
//
// KEEP IN SYNC with the real subscriptions:
//   graph-builder  → graph-builder/subscriber.ts GRAPH_EVENT_CHANNELS
//   trigger-engine → triggers/subscriber.ts EVENT_CHANNELS
//   alert-subscriber / incident-subscriber / trigger-executor → their files
const EXPECTED_CONSUMERS: Record<string, string[]> = {
  alert_fired: ['graph-builder', 'trigger-engine', 'alert-subscriber'],
  incident_created: ['graph-builder', 'trigger-engine', 'incident-subscriber'],
  deploy_completed: ['graph-builder', 'trigger-engine'],
  deploy_failed: ['trigger-engine'],
  error_rate_threshold: ['trigger-engine'],
  test_failed: ['trigger-engine'],
  cloud_finding: ['trigger-engine'],
  pr_merged: ['graph-builder', 'trigger-engine'],
  ticket_created: ['graph-builder'],
  connector_registered: ['graph-builder'],
  connector_removed: ['graph-builder'],
  connector_reconnected: ['graph-builder'],
  project_created: ['graph-builder'],
  repo_created: ['graph-builder'],
  namespace_created: ['graph-builder'],
  resource_added: ['graph-builder'],
  team_changed: ['graph-builder'],
  oncall_rotation: ['graph-builder'],
  connector_capability_changed: ['graph-builder'],
  trigger_matched: ['trigger-executor'],
}

export async function replayUnconsumedEvents(
  pub: Pick<RedisClientType, 'publish'>,
): Promise<{ replayed: number }> {
  // Iterate tenants explicitly — RLS-safe, same pattern as freshness-daemon.
  const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM tenants`.catch(() => [] as { id: string }[])
  let replayed = 0

  // Flatten the expected-consumers map into (channel, consumer) pairs the
  // SQL can join against — an event needs replay when any expected pair
  // has no matching consumption row.
  const pairs: Array<{ channel: string; consumer: string }> = []
  for (const [channel, consumers] of Object.entries(EXPECTED_CONSUMERS)) {
    for (const consumer of consumers) pairs.push({ channel, consumer })
  }
  const pairChannels = pairs.map((p) => p.channel)
  const pairConsumers = pairs.map((p) => p.consumer)

  for (const { id: tenantId } of tenants) {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string; channel: string; payload: Record<string, unknown> }>>`
        UPDATE event_log el
        SET replay_count = replay_count + 1
        WHERE el.id IN (
          SELECT DISTINCT e.id
          FROM event_log e
          JOIN unnest(${pairChannels}::text[], ${pairConsumers}::text[]) AS exp(channel, consumer)
            ON exp.channel = e.channel
          LEFT JOIN event_consumptions c
            ON c.event_id = e.id AND c.consumer = exp.consumer
          WHERE e.tenant_id = ${tenantId}::uuid
            AND c.event_id IS NULL
            AND e.replay_count < ${MAX_REPLAYS}
            AND e.created_at < NOW() - (${REPLAY_GRACE_SECONDS}::int * INTERVAL '1 second')
            AND e.created_at > NOW() - (${REPLAY_MAX_AGE_HOURS}::int * INTERVAL '1 hour')
          LIMIT 50
        )
        RETURNING el.id, el.channel, el.payload
      `
    ).catch((err: Error) => {
      // Same lesson as incident-correlation.ts: a silent catch here hid a
      // real SQL error (make_interval + Prisma bigint binding) — the
      // replayer was a no-op while looking healthy. Log loudly.
      log.error({ err, tenantId }, 'event replay candidate query failed')
      return [] as Array<{ id: string; channel: string; payload: Record<string, unknown> }>
    })

    for (const row of rows) {
      try {
        await pub.publish(row.channel, JSON.stringify({ ...row.payload, __eventLogId: row.id }))
        replayed++
      } catch (err) {
        log.warn({ err, eventLogId: row.id, channel: row.channel }, 'replay publish failed — will retry next cycle')
      }
    }
  }

  if (replayed > 0) log.info({ replayed }, 'replayed unconsumed events')
  return { replayed }
}

/** Retention: delete event_log rows older than 7 days. */
export async function purgeOldEvents(): Promise<{ purged: number }> {
  const tenants = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM tenants`.catch(() => [] as { id: string }[])
  let purged = 0
  for (const { id: tenantId } of tenants) {
    const n = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`DELETE FROM event_log WHERE tenant_id = ${tenantId}::uuid AND created_at < NOW() - INTERVAL '7 days'`
    ).catch(() => 0)
    purged += Number(n)
  }
  return { purged }
}
