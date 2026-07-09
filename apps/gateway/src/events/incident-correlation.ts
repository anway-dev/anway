// Incident → CAUSED_BY → Deploy correlation.
//
// Confirmed via independent review: the canonical CLAUDE.md schema edge
// `(Incident)-[:CAUSED_BY]->(Deploy)` was never written by anything —
// SREAgent's RCA landed only as free-text suggested_root_cause, so "what
// changed before X broke" (the single highest-value SRE correlation, and
// the prerequisite for the Change Timeline feature) had no structured,
// queryable answer in the graph.
//
// Deterministic time-window correlation (no LLM):
//   - resolve the incident's service (explicit serviceHint from the alert
//     labels when present; otherwise match Service entity names against the
//     incident title/description)
//   - find Deploy entities touching that service updated within the 2h
//     window before the incident
//   - write Incident-[:CAUSED_BY]->Deploy with a confidence score:
//     0.8 for a deploy within 30 minutes, 0.6 within 2 hours — and the
//     established `unconfirmed: confidence < 0.7` KB policy flag
//     (builder.ts's exact pattern), so a looser match is stored as a
//     surfaced hypothesis, not asserted fact.

import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import pino from 'pino'

const log = pino({ name: 'incident-correlation' })

const WINDOW_HOURS = 2
const HIGH_CONFIDENCE_MINUTES = 30

interface DeployCandidate {
  id: string
  name: string
  minutes_before: number
}

export async function correlateIncidentToDeploys(
  kg: IKnowledgeGraph,
  tenantId: string,
  incidentId: string,
  title: string,
  description: string | undefined,
  serviceHint: string | undefined,
): Promise<{ correlated: number }> {
  // 1. Resolve the affected service name.
  let service = serviceHint?.trim() || null
  if (!service) {
    // Match known Service entity names against the incident text — longest
    // name first so "payments-api" wins over a hypothetical "api".
    const text = `${title} ${description ?? ''}`.toLowerCase()
    const services = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Service'
        ORDER BY LENGTH(name) DESC LIMIT 500
      `
    ).catch(() => [] as Array<{ name: string }>)
    service = services.find(s => text.includes(s.name.toLowerCase()))?.name ?? null
  }
  if (!service) return { correlated: 0 }

  // 2. Deploy entities touching this service in the window before now.
  // (This runs moments after incident creation, so NOW() approximates the
  // incident start; Deploy.updated_at is bumped by every real deploy event
  // — see structural-graph.ts's upsertEntity.)
  const candidates = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<DeployCandidate[]>`
      SELECT id, name,
             EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 AS minutes_before
      FROM entities
      WHERE tenant_id = ${tenantId}::uuid AND type = 'Deploy'
        AND updated_at > NOW() - (${WINDOW_HOURS}::int * INTERVAL '1 hour')
        AND (
          metadata->>'service' = ${service}
          OR name ILIKE '%' || ${service} || '%'
        )
      ORDER BY updated_at DESC
      LIMIT 5
    `
  ).catch((err: Error) => {
    // Confirmed live via the first real E2E run of this correlation: a
    // silent `.catch(() => [])` here swallowed a real SQL error (Prisma
    // binds JS numbers as bigint — `make_interval(hours => bigint)` does
    // not exist in Postgres) and made the whole feature a no-op that
    // looked exactly like "no deploys in the window". Log loudly.
    log.error({ err, tenantId, incidentId, service }, 'CAUSED_BY candidate query failed')
    return [] as DeployCandidate[]
  })
  if (candidates.length === 0) return { correlated: 0 }

  // 3. Idempotently ensure the Incident entity exists (graph-builder's
  // onIncidentCreated upserts the same (tenant, 'Incident', incidentId) key
  // — this handles the race where correlation runs before it).
  const incidentEntityId = await kg.upsertEntity(
    { type: 'Incident', name: incidentId, metadata: { title } },
    tenantId as TenantId,
  )

  let correlated = 0
  for (const deploy of candidates) {
    const confidence = Number(deploy.minutes_before) <= HIGH_CONFIDENCE_MINUTES ? 0.8 : 0.6
    await kg.upsertRelationship({
      fromEntityId: incidentEntityId,
      relType: 'CAUSED_BY',
      toEntityId: deploy.id,
      metadata: {
        confidence,
        unconfirmed: confidence < 0.7,
        source: 'deploy-time-correlation',
        minutesBefore: Math.round(Number(deploy.minutes_before)),
        service,
      },
    }, tenantId as TenantId)
    correlated++
  }

  log.info({ tenantId, incidentId, service, correlated }, 'incident CAUSED_BY deploy correlation written')
  return { correlated }
}
