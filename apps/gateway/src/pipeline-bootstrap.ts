/**
 * Pipeline Bootstrap Subscriber
 *
 * Listens on Redis for connector_registered events.
 * When a GitHub/GitLab/Bitbucket connector connects → auto-creates a promotion
 * pipeline per repo, with environments loaded from the tenant's environments table.
 * Environments are user-defined (staging/preprod/prod by default) — not derived
 * from connected connectors.
 */
import { createClient } from 'redis'
import { prisma } from './db/client.js'
import { withTenant } from './db/prisma.js'

interface Logger { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }

// Source control connectors that trigger pipeline auto-creation
const REPO_CONNECTOR_TYPES = new Set(['github', 'gitlab', 'bitbucket'])

const ENV_STAGE_DEFS = [
  { suffix: 'test',    name: 'Test',    icon: '✓', type: 'tests'   },
  { suffix: 'deploy',  name: 'Deploy',  icon: '▶', type: 'deploy'  },
  { suffix: 'monitor', name: 'Monitor', icon: '◎', type: 'monitor' },
]

interface EnvDef { id: string; name: string; label: string; color: string }

function buildStagesFromEnvs(envs: EnvDef[]): object[] {
  const stages: object[] = []
  envs.forEach((env, i) => {
    if (i > 0) {
      stages.push({ id: `gate.${env.name}`, name: `→ ${env.label}`, icon: '⊡', color: '#f59e0b', type: 'gate', gate: true, env: null })
    }
    ENV_STAGE_DEFS.forEach(def => {
      stages.push({ id: `${env.name}.${def.suffix}`, name: def.name, icon: def.icon, color: env.color, type: def.type, gate: false, env: env.name, envLabel: env.label })
    })
  })
  return stages
}

/** Load user-defined environments from DB. */
async function loadEnvs(tenantId: string): Promise<EnvDef[]> {
  interface EnvRow { id: string; name: string; label: string; color: string; sort_order: number }
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<EnvRow[]>`
      SELECT id, name, label, color, sort_order
      FROM environments
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY sort_order ASC, created_at ASC
    `,
  ).catch(() => [] as EnvRow[])

  if (rows.length > 0) return rows.map(r => ({ id: r.id, name: r.name, label: r.label, color: r.color }))

  // Default if environments table is empty (before migration runs or first boot)
  return [
    { id: 'staging', name: 'staging', label: 'Staging',        color: '#3b82f6' },
    { id: 'preprod', name: 'preprod', label: 'Pre-production', color: '#f59e0b' },
    { id: 'prod',    name: 'prod',    label: 'Production',     color: '#ef4444' },
  ]
}

/**
 * Auto-create a pipeline for a service name if one doesn't exist yet.
 */
async function ensurePipelineForService(tenantId: string, serviceName: string, log: Logger): Promise<void> {
  // Check if a pipeline already exists for this service
  const existing = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM pipelines
      WHERE tenant_id = ${tenantId}::uuid AND name = ${serviceName}
      LIMIT 1
    `,
  ).catch(() => [])

  const envs = await loadEnvs(tenantId)
  const stages = buildStagesFromEnvs(envs)
  const stagesJson = JSON.stringify(stages)
  const meta = JSON.stringify({ autoCreated: true, serviceName })

  if (existing.length > 0) {
    // Pipeline exists — update stages to reflect current detected connectors
    await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`
        UPDATE pipelines
        SET stages = ${stagesJson}::jsonb, updated_at = now()
        WHERE id = ${existing[0]!.id}::uuid AND tenant_id = ${tenantId}::uuid
      `,
    ).catch(() => null)
    log.info({ tenantId, serviceName, envCount: envs.length }, 'pipeline-bootstrap: updated pipeline stages')
  } else {
    // Create new pipeline
    await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`
        INSERT INTO pipelines (id, tenant_id, name, description, stages, status, metadata, created_at, updated_at)
        VALUES (
          gen_random_uuid(), ${tenantId}::uuid, ${serviceName},
          ${'Auto-created from connector registration'},
          ${stagesJson}::jsonb, 'idle', ${meta}::jsonb, now(), now()
        )
      `,
    ).catch(() => null)
    log.info({ tenantId, serviceName, envCount: envs.length }, 'pipeline-bootstrap: created pipeline')
  }
}

/**
 * When a deployment connector registers, update all existing pipelines for this tenant
 * to include the new environment.
 */
async function rebuildPipelinesForTenant(tenantId: string, log: Logger): Promise<void> {
  const envs = await loadEnvs(tenantId)
  const stages = buildStagesFromEnvs(envs)
  const stagesJson = JSON.stringify(stages)

  await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw`
      UPDATE pipelines
      SET stages = ${stagesJson}::jsonb, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
        AND (metadata->>'autoCreated')::boolean = true
    `,
  ).catch(() => null)

  log.info({ tenantId, envCount: envs.length }, 'pipeline-bootstrap: rebuilt stages for all auto-created pipelines')
}

export async function startPipelineBootstrapSubscriber(redisUrl: string, log: Logger): Promise<void> {
  const sub = createClient({ url: redisUrl })
  await sub.connect()

  // Listen on connector_registered — same channel as graph builder
  await sub.subscribe('connector_registered', async (message) => {
    let event: { type: string; tenantId: string; connectorType: string; payload?: Record<string, unknown> }
    try { event = JSON.parse(message) } catch { return }

    const { tenantId, connectorType } = event
    if (!tenantId || !connectorType) return

    if (REPO_CONNECTOR_TYPES.has(connectorType)) {
      // GitHub connected — create a pipeline per repo we know about.
      // Query entities table for repos seeded by graph bootstrap.
      interface RepoRow { name: string }
      const repos = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<RepoRow[]>`
          SELECT name FROM entities
          WHERE tenant_id = ${tenantId}::uuid AND type = 'Repo'
          LIMIT 20
        `,
      ).catch(() => [] as RepoRow[])

      if (repos.length === 0) {
        // Fallback — bootstrap hasn't run yet; create a placeholder pipeline from payload
        const orgOrRepo = (event.payload?.['org'] ?? event.payload?.['repo'] ?? 'my-service') as string
        await ensurePipelineForService(tenantId, orgOrRepo, log)
      } else {
        for (const repo of repos) {
          await ensurePipelineForService(tenantId, repo.name, log)
        }
      }
    }
  })

  log.info({}, 'PipelineBootstrapSubscriber started')
}
