/**
 * Graph Mapping Phase — runs after every connector bootstrap and on schedule.
 *
 * Bootstrap phase: each connector creates entities from its own data.
 * Mapping phase: resolves cross-entity relationships once all entities exist.
 *
 * This separation ensures relationships are correct even when the source entity
 * (e.g. a Service) comes from a different connector than the target entity
 * (e.g. a Dashboard from Grafana).
 */
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { createKnowledgeGraph } from '../kb/index.js'
import type { TenantId } from '@anvay/types'

export interface MappingResult {
  tenantsProcessed: number
  relationshipsUpserted: number
  durationMs: number
}

export interface TenantMappingResult {
  relationshipsUpserted: number
  durationMs: number
}

interface EntityRow {
  id: string
  type: string
  name: string
  metadata: Record<string, unknown>
}

/** Build a lowercase-name → id map for a given entity type. */
function buildNameMap(entities: EntityRow[], type: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of entities) {
    if (e.type === type) m.set(e.name.toLowerCase(), e.id)
  }
  return m
}

/** Returns the first service id whose name appears in the given text. */
function findServiceByNameContains(text: string, serviceMap: Map<string, string>): string | undefined {
  const lower = text.toLowerCase()
  for (const [svcName, svcId] of serviceMap) {
    if (svcName.length >= 3 && lower.includes(svcName)) return svcId
  }
  return undefined
}

async function upsertRel(
  kg: ReturnType<typeof createKnowledgeGraph>,
  fromId: string,
  relType: string,
  toId: string,
  tenantId: TenantId,
  counter: { n: number },
): Promise<void> {
  const r = await kg.upsertRelationship({ fromEntityId: fromId, relType, toEntityId: toId, metadata: {} }, tenantId).catch(() => '')
  if (r) counter.n++
}

/**
 * Run the mapping phase for a single tenant.
 * Loads all entities and resolves cross-entity relationships.
 */
export async function runTenantMappingPhase(tenantId: string): Promise<TenantMappingResult> {
  const start = Date.now()
  const tid = tenantId as TenantId
  const kg = createKnowledgeGraph(tid)
  const counter = { n: 0 }

  const entities = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<EntityRow[]>`
      SELECT id, type, name, metadata FROM entities WHERE tenant_id = ${tenantId}::uuid
    `
  ).catch(() => [] as EntityRow[])

  if (entities.length === 0) return { relationshipsUpserted: 0, durationMs: Date.now() - start }

  const serviceMap = buildNameMap(entities, 'Service')

  // ── 1. Dashboard → MONITORS → Service ───────────────────────────────────────
  // Pattern: "{service} — Service Overview" (Grafana default)
  // Also: dashboard name contains service name
  for (const e of entities) {
    if (e.type !== 'Dashboard') continue
    const meta = e.metadata

    // Try explicit service field in metadata
    const metaSvc = (meta['service'] ?? meta['serviceName']) as string | undefined
    if (metaSvc) {
      const svcId = serviceMap.get(metaSvc.toLowerCase())
      if (svcId) { await upsertRel(kg, e.id, 'MONITORS', svcId, tid, counter); continue }
    }

    // Pattern match: strip "— Service Overview" suffix from title
    const stripped = e.name.replace(/\s*[—–-]+\s*Service Overview$/i, '').trim().toLowerCase()
    const svcIdByStrip = serviceMap.get(stripped)
    if (svcIdByStrip) { await upsertRel(kg, e.id, 'MONITORS', svcIdByStrip, tid, counter); continue }

    // Grafana connectorCoordinates title field
    const coords = meta['connectorCoordinates'] as Record<string, { resourceIds?: Record<string, string> }> | undefined
    const grafanaTitle = coords?.['grafana']?.resourceIds?.['title']
    if (grafanaTitle) {
      const stripped2 = grafanaTitle.replace(/\s*[—–-]+\s*Service Overview$/i, '').trim().toLowerCase()
      const svcId2 = serviceMap.get(stripped2)
      if (svcId2) { await upsertRel(kg, e.id, 'MONITORS', svcId2, tid, counter); continue }
    }

    // Fallback: name contains a service name
    const svcIdByContains = findServiceByNameContains(e.name, serviceMap)
    if (svcIdByContains) await upsertRel(kg, e.id, 'MONITORS', svcIdByContains, tid, counter)
  }

  // ── 2. Alert → MONITORS → Service ───────────────────────────────────────────
  // Grafana/Prometheus alerts carry labels; Datadog/CloudWatch/Sentry carry names
  for (const e of entities) {
    if (e.type !== 'Alert') continue
    const meta = e.metadata

    // Labels: service, job, exported_service (Prometheus convention)
    const labels = (meta['labels'] ?? {}) as Record<string, string>
    const svcLabel = labels['service'] ?? labels['job'] ?? labels['exported_service']
    if (svcLabel) {
      const svcId = serviceMap.get(svcLabel.toLowerCase())
      if (svcId) { await upsertRel(kg, e.id, 'MONITORS', svcId, tid, counter); continue }
    }

    // Explicit metadata field
    const metaSvc = (meta['service'] ?? meta['serviceName']) as string | undefined
    if (metaSvc) {
      const svcId = serviceMap.get(metaSvc.toLowerCase())
      if (svcId) { await upsertRel(kg, e.id, 'MONITORS', svcId, tid, counter); continue }
    }

    // Fallback: alert name contains a service name
    const svcIdByContains = findServiceByNameContains(e.name, serviceMap)
    if (svcIdByContains) await upsertRel(kg, e.id, 'MONITORS', svcIdByContains, tid, counter)
  }

  // ── 3. Incident → AFFECTS → Service ─────────────────────────────────────────
  for (const e of entities) {
    if (e.type !== 'Incident') continue
    const meta = e.metadata
    const metaSvc = (meta['service'] ?? meta['serviceName']) as string | undefined
    if (metaSvc) {
      const svcId = serviceMap.get(metaSvc.toLowerCase())
      if (svcId) { await upsertRel(kg, e.id, 'AFFECTS', svcId, tid, counter); continue }
    }
    const svcIdByContains = findServiceByNameContains(e.name, serviceMap)
    if (svcIdByContains) await upsertRel(kg, e.id, 'AFFECTS', svcIdByContains, tid, counter)
  }

  // ── 4. Ticket → RELATES_TO → Service ────────────────────────────────────────
  // Linear/Jira tickets may not have explicit service — fall back to name matching
  for (const e of entities) {
    if (e.type !== 'Ticket') continue
    const meta = e.metadata
    const metaSvc = (meta['service'] ?? meta['serviceName'] ?? meta['component']) as string | undefined
    if (metaSvc) {
      const svcId = serviceMap.get(metaSvc.toLowerCase())
      if (svcId) { await upsertRel(kg, e.id, 'RELATES_TO', svcId, tid, counter); continue }
    }
    // Title-based: only match if service name is long enough to avoid false positives
    const svcIdByContains = findServiceByNameContains(e.name, serviceMap)
    if (svcIdByContains) await upsertRel(kg, e.id, 'RELATES_TO', svcIdByContains, tid, counter)
  }

  // ── 5. Deploy → DEPLOYED_TO → Service ───────────────────────────────────────
  // ArgoCD/Jenkins deploys may lack explicit service link if Service entity was added later
  for (const e of entities) {
    if (e.type !== 'Deploy') continue
    const meta = e.metadata
    const metaSvc = (meta['service'] ?? meta['serviceName'] ?? meta['app'] ?? meta['applicationName']) as string | undefined
    if (metaSvc) {
      const svcId = serviceMap.get(metaSvc.toLowerCase())
      if (svcId) await upsertRel(kg, e.id, 'DEPLOYED_TO', svcId, tid, counter)
    }
  }

  return { relationshipsUpserted: counter.n, durationMs: Date.now() - start }
}

/**
 * Run the mapping phase for ALL tenants that have at least one connector.
 * Used by the periodic cron job.
 */
export async function runMappingPhaseAllTenants(): Promise<MappingResult> {
  const start = Date.now()
  const tenants = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT tenant_id AS id FROM connector_config WHERE enabled = true
  `.catch(() => [] as { id: string }[])

  let totalRelationships = 0
  for (const { id } of tenants) {
    const result = await runTenantMappingPhase(id).catch(() => ({ relationshipsUpserted: 0, durationMs: 0 }))
    totalRelationships += result.relationshipsUpserted
  }

  return { tenantsProcessed: tenants.length, relationshipsUpserted: totalRelationships, durationMs: Date.now() - start }
}
