import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { decryptJson } from '../utils/crypto.js'
import { UUID_RE } from '../utils/validators.js'
import { requireRole } from '../plugins/rbac.js'
import type { FastifyLoggerInstance } from 'fastify'

// Module-level EventEmitter for single-pod SSE fan-out (no Redis)
import { EventEmitter } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo-relative paths below (docker build context, tsconfig, helm chart) are
// resolved against this, not process.cwd() — the real runtime cwd when
// running via `pnpm --filter anway-gateway dev` is apps/gateway/, not the
// repo root, which silently broke every one of these spawn calls (confirmed
// live: docker build failed with "path apps/gateway not found").
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')

// The literal string 'latest' as a final fallback tag is a real, critical bug
// confirmed live: Kubernetes only re-pulls a mutable tag like `:latest` when a
// pod is newly *created* (scale-up, manual restart) — it does NOT re-pull or
// restart already-running pods just because the tag's underlying digest
// changed. Every `helm upgrade` against an already-running release therefore
// reported success while silently leaving existing pods on stale code (caught
// by comparing containerStatuses[0].imageID across two replicas of the same
// ReplicaSet after an HPA-triggered scale-up pulled fresh 'latest' — a
// day-old sibling pod was still on a completely different image digest).
// Default to the real current commit SHA instead, so every build/deploy
// produces a genuinely immutable tag and every deploy is a real rolling
// restart, not a no-op that happens to report done=true.
function resolveGitSha(): string {
  try {
    const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' })
    const sha = result.stdout?.trim()
    if (result.status === 0 && sha) return sha
  } catch { /* fall through */ }
  return 'latest'
}

// The app's own operational secrets (ANWAY_ENCRYPTION_KEY, JWT_SECRET) were only
// ever sourced from this gateway process's local .env — real for a dev machine,
// not for production. If a real 'vault' connector is registered for this
// tenant, prefer reading these from its actual KV v2 store instead. Falls back
// to the existing process.env-based logic (untouched) if no vault connector is
// registered, or if the read fails for any reason — deploy must not become
// impossible just because Vault is briefly unreachable.
async function fetchGatewaySecretsFromVault(
  tenantId: string,
): Promise<{ encryptionKey?: string; jwtSecret?: string } | null> {
  const vaultRows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ credentials_enc: string }>>`
      SELECT credentials_enc FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND connector_type = 'vault' AND enabled = true LIMIT 1
    `
  ).catch(() => [])
  if (vaultRows.length === 0) return null

  try {
    const creds = decryptJson(vaultRows[0]!.credentials_enc) as { baseUrl?: string; token?: string; apiKey?: string }
    const baseUrl = (creds.baseUrl ?? 'http://localhost:8200').replace(/\/$/, '')
    const token = creds.token ?? creds.apiKey
    if (!token) return null

    // KV v2 real REST path: secret data lives under {mount}/data/{path}, one
    // level deeper than the KV path itself (metadata/list operations use
    // {mount}/metadata/{path} instead — a different real Vault convention).
    const res = await fetch(`${baseUrl}/v1/secret/data/anway/gateway`, {
      headers: { 'X-Vault-Token': token },
    })
    if (!res.ok) return null
    const body = await res.json() as { data?: { data?: Record<string, string> } }
    const kv = body.data?.data ?? {}
    const result: { encryptionKey?: string; jwtSecret?: string } = {}
    if (kv['ANWAY_ENCRYPTION_KEY']) result.encryptionKey = kv['ANWAY_ENCRYPTION_KEY']
    if (kv['JWT_SECRET']) result.jwtSecret = kv['JWT_SECRET']
    return result
  } catch {
    return null
  }
}

// A kubeconfig captured on the host (e.g. from `orbstack`/`kind`/`minikube`,
// which expose the API server on the host's loopback) is unusable as-is from
// inside this gateway's own container — 127.0.0.1/localhost there means the
// container itself, not the host. Rewrite to a hostname that's actually
// reachable AND present in the API server's TLS cert SAN list from inside a
// container (confirmed live: helm failed with "dial tcp 127.0.0.1:26443:
// connect: connection refused" until this rewrite was added).
// host.docker.internal resolves but is NOT in OrbStack's cert SAN (would fail
// TLS verification); k8s.orb.local is OrbStack's own in-container-safe name
// and IS in the SAN list. Other local-cluster tooling (kind, minikube, Docker
// Desktop's k8s) would need their own equivalent — this only covers OrbStack,
// the environment this gateway actually runs in.
function rewriteKubeconfigForContainer(kubeconfig: string): string {
  if (!existsSync('/.dockerenv')) return kubeconfig
  return kubeconfig.replace(
    /(server:\s*https?:\/\/)(127\.0\.0\.1|localhost)(:)/g,
    '$1k8s.orb.local$3',
  )
}

/**
 * Resolve a kubeconfig path for the tenant's K8s or EKS connector.
 * Returns `{ path, cleanup }` — caller MUST call cleanup() when done.
 * Falls back to KUBECONFIG env var if no connector configured.
 */
async function resolveKubeconfigPath(tenantId: string): Promise<{ path: string; cleanup: () => void }> {
  const noop = () => {}
  try {
    const rows = await prisma.$queryRaw<Array<{ credentials_enc: string | null }>>`
      SELECT credentials_enc FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND connector_type IN ('k8s', 'eks') AND enabled = true
      ORDER BY bootstrapped_at DESC NULLS LAST LIMIT 1
    `
    if (rows.length > 0 && rows[0]!.credentials_enc) {
      const creds = decryptJson<Record<string, unknown>>(rows[0]!.credentials_enc)
      const kubeconfig = creds['kubeconfig'] as string | undefined
      if (kubeconfig && kubeconfig.trimStart().startsWith('apiVersion')) {
        const tmp = join(tmpdir(), `anway-k8s-${tenantId}-${Date.now()}.yaml`)
        writeFileSync(tmp, rewriteKubeconfigForContainer(kubeconfig), { mode: 0o600 })
        return { path: tmp, cleanup: () => { try { unlinkSync(tmp) } catch {} } }
      }
      if (kubeconfig) {
        return { path: kubeconfig, cleanup: noop }
      }
    }
  } catch { /* fall back to env */ }
  return { path: process.env['KUBECONFIG'] ?? '', cleanup: noop }
}
const stageRunEvents = new EventEmitter()
stageRunEvents.setMaxListeners(200)

// Per-tenant concurrency limit for expensive stage runs (docker build, helm, terraform)
const MAX_CONCURRENT_RUNS_PER_TENANT = 3
const tenantRunCount = new Map<string, number>()

function acquireRunSlot(tenantId: string): boolean {
  const current = tenantRunCount.get(tenantId) ?? 0
  if (current >= MAX_CONCURRENT_RUNS_PER_TENANT) return false
  tenantRunCount.set(tenantId, current + 1)
  return true
}

function releaseRunSlot(tenantId: string): void {
  const current = tenantRunCount.get(tenantId) ?? 1
  const next = Math.max(0, current - 1)
  if (next === 0) tenantRunCount.delete(tenantId)
  else tenantRunCount.set(tenantId, next)
}

// Track active child processes by runId so we can kill on disconnect or cancel
const activeRunChildren = new Map<string, ChildProcess[]>()

function killRunChildren(runId: string): void {
  const children = activeRunChildren.get(runId) ?? []
  for (const child of children) {
    try { child.kill('SIGTERM') } catch { /* already exited */ }
  }
  activeRunChildren.delete(runId)
}

interface PipelineRow {
  id: string
  name: string
  description: string | null
  stages: unknown
  status: string
  created_at: Date
  updated_at: Date
}

interface StageRunRow {
  id: string
  pipeline_id: string
  stage_id: string
  status: string
  output: unknown
  started_at: Date | null
  finished_at: Date | null
}

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
      stages.push({
        id: `gate.${env.name}`,
        name: `→ ${env.label}`,
        icon: '⊡',
        color: '#f59e0b',
        type: 'gate',
        gate: true,
        env: null,
      })
    }
    ENV_STAGE_DEFS.forEach(def => {
      stages.push({
        id: `${env.name}.${def.suffix}`,
        name: def.name,
        icon: def.icon,
        color: env.color,
        type: def.type,
        gate: false,
        env: env.name,
        envLabel: env.label,
      })
    })
  })
  return stages
}

const FALLBACK_STAGES = buildStagesFromEnvs([
  { id: 'staging', name: 'staging', label: 'Staging',        color: '#3b82f6' },
  { id: 'preprod', name: 'preprod', label: 'Pre-production', color: '#f59e0b' },
  { id: 'prod',    name: 'prod',    label: 'Production',     color: '#ef4444' },
])

/** Load environments from DB — the user-defined ordered list. Falls back to staging/preprod/prod. */
async function loadStagesForTenant(tenantId: string): Promise<object[]> {
  interface EnvRow { id: string; name: string; label: string; color: string; sort_order: number }
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<EnvRow[]>`
      SELECT id, name, label, color, sort_order
      FROM environments
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY sort_order ASC, created_at ASC
    `,
  ).catch(() => [] as EnvRow[])

  if (rows.length === 0) return FALLBACK_STAGES
  return buildStagesFromEnvs(rows.map(r => ({ id: r.id, name: r.name, label: r.label, color: r.color })))
}

async function runRollback(pipelineId: string, tenantId: string, prevState: unknown, log: FastifyLoggerInstance): Promise<void> {
  try {
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE pipeline_stage_runs
        SET status = 'running', output = output || '{"rollback_progress":"applying previous terraform state"}'::jsonb
        WHERE pipeline_id = ${pipelineId}::uuid AND stage_id = 'rollback' AND tenant_id = ${tenantId}::uuid AND status = 'running'
      `
    )

    // Execute terraform apply with previous state via subprocess
    const stateJson = JSON.stringify(prevState)
    const tfDir = process.env['TF_DIR'] ?? 'infra/terraform'

    try {
      const { spawn } = await import('node:child_process')
      const filteredEnv: Record<string, string | undefined> = {}
      for (const [k, v] of Object.entries(process.env)) {
        if (/^(AWS_|GCP_|AZURE_|TF_|KUBECONFIG|HELM_|DOCKER_|GITHUB_)/.test(k)) filteredEnv[k] = v
      }
      filteredEnv['PATH'] = process.env['PATH']
      filteredEnv['HOME'] = process.env['HOME']
      await new Promise<void>((resolve, reject) => {
        const child = spawn('terraform', ['apply', '-auto-approve', '-state', '-'], {
          cwd: tfDir,
          env: filteredEnv as Record<string, string>,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        child.stdin.write(stateJson)
        child.stdin.end()
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        child.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`terraform apply exited ${code}: ${stderr || stdout}`))
        })
        child.on('error', reject)
        setTimeout(() => { child.kill(); reject(new Error('terraform apply timed out after 120s')) }, 120_000)
      })

      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE pipeline_stage_runs
          SET status = 'success', finished_at = now(),
              output = output || '{"rollback_result":"terraform apply succeeded"}'::jsonb
          WHERE pipeline_id = ${pipelineId}::uuid AND stage_id = 'rollback' AND tenant_id = ${tenantId}::uuid
        `
      )
    } catch (tfErr) {
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE pipeline_stage_runs
          SET status = 'failed', finished_at = now(),
              output = output || ${JSON.stringify({ rollback_error: String(tfErr) })}::jsonb
          WHERE pipeline_id = ${pipelineId}::uuid AND stage_id = 'rollback' AND tenant_id = ${tenantId}::uuid
        `
      )
    }
  } catch (err) {
    log.error({ err }, 'runRollback failed')
  }
}

export async function pipelineRoutes(app: FastifyInstance) {
  // GET /api/pipelines
  app.get('/api/pipelines', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { cursor, limit: limitStr } = request.query as { cursor?: string; limit?: string }
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500)

    if (cursor && !UUID_RE.test(cursor)) {
      return reply.code(400).send({ error: 'invalid cursor' })
    }

    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<PipelineRow[]>`
        SELECT id, name, description, stages, status, created_at, updated_at
        FROM pipelines
        WHERE tenant_id = ${tenantId}::uuid
        ${cursor ? Prisma.sql`AND id > ${cursor}::uuid` : Prisma.sql``}
        ORDER BY id ASC
        LIMIT ${limit + 1}
      `,
    ).catch(() => [] as PipelineRow[])

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows

    return reply.send({
      data: data.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        stages: r.stages ?? FALLBACK_STAGES,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      nextCursor: hasMore ? data[data.length - 1]!.id : null,
    })
  })

  // POST /api/pipelines
  app.post<{ Body: { name: string; description?: string; stages?: unknown[]; context?: string; serviceName?: string } }>(
    '/api/pipelines',
    { preHandler: [app.authenticate, requireRole('admin', 'sre', 'dev')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { name: rawName, description: rawDesc, stages, context, serviceName } = request.body
      const name = rawName?.replace(/<[^>]*>/g, '').trim()
      const description = rawDesc ? rawDesc.replace(/<[^>]*>/g, '').trim() : ''

      if (!name) return reply.code(400).send({ error: 'name required' })

      const resolvedStages = stages ?? await loadStagesForTenant(tenantId)
      const stagesJson = JSON.stringify(resolvedStages)
      const meta = JSON.stringify({ context: context ?? '', serviceName: serviceName ?? '' })

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO pipelines (id, tenant_id, name, description, stages, status, metadata, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${name}, ${description}, ${stagesJson}::jsonb, 'idle', ${meta}::jsonb, now(), now())
          RETURNING id
        `,
      ).catch(() => [] as Array<{ id: string }>)

      if (rows.length === 0) return reply.code(500).send({ error: 'create failed' })

      return reply.code(201).send({
        id: rows[0]!.id,
        name,
        description,
        stages: resolvedStages,
        status: 'idle',
      })
    },
  )

  // GET /api/pipelines/:id
  app.get<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id } = request.params

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<PipelineRow[]>`
          SELECT id, name, description, stages, status, created_at, updated_at
          FROM pipelines
          WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          LIMIT 1
        `,
      ).catch(() => [] as PipelineRow[])

      if (rows.length === 0) return reply.code(404).send({ error: 'not found' })

      const stageRuns = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<StageRunRow[]>`
          SELECT id, pipeline_id, stage_id, status, output, started_at, finished_at
          FROM pipeline_stage_runs
          WHERE pipeline_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          ORDER BY started_at DESC
        `,
      ).catch(() => [] as StageRunRow[])

      // Latest run per stage
      const latestByStage = new Map<string, StageRunRow>()
      for (const run of stageRuns) {
        if (!latestByStage.has(run.stage_id)) latestByStage.set(run.stage_id, run)
      }

      const pipeline = rows[0]!
      const stages = (pipeline.stages as typeof FALLBACK_STAGES) ?? FALLBACK_STAGES

      return reply.send({
        id: pipeline.id,
        name: pipeline.name,
        description: pipeline.description,
        status: pipeline.status,
        stages: (stages as Record<string, unknown>[]).map((s) => ({
          ...s,
          run: latestByStage.has(s['id'] as string) ? {
            status: latestByStage.get(s['id'] as string)!.status,
            output: latestByStage.get(s['id'] as string)!.output,
            startedAt: latestByStage.get(s['id'] as string)!.started_at,
            finishedAt: latestByStage.get(s['id'] as string)!.finished_at,
          } : null,
        })),
        createdAt: pipeline.created_at,
        updatedAt: pipeline.updated_at,
      })
    },
  )

  // POST /api/pipelines/:id/stages/:stageId/run — SSE stream
  app.post<{ Params: { id: string; stageId: string }; Body: { input?: string } }>(
    '/api/pipelines/:id/stages/:stageId/run',
    { preHandler: [app.authenticate, requireRole('admin', 'sre', 'dev')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id, stageId } = request.params
      const { input } = request.body ?? {}

      const pipelines = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ stages: unknown; status: string; name: string; metadata: unknown }>>`
          SELECT stages, status, name, metadata FROM pipelines
          WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
        `,
      ).catch(() => [])

      if (pipelines.length === 0) return reply.code(404).send({ error: 'pipeline not found' })

      const stages = (pipelines[0]!.stages as Array<Record<string, unknown>>) ?? FALLBACK_STAGES
      const stage = stages.find(s => s['id'] === stageId)
      if (!stage) return reply.code(404).send({ error: 'stage not found' })

      // Rate limit: max 3 concurrent stage runs per tenant to prevent resource exhaustion
      let slotReleased = false
      const releaseSlot = () => {
        if (!slotReleased) { slotReleased = true; releaseRunSlot(tenantId) }
      }
      if (!acquireRunSlot(tenantId)) {
        return reply.code(429).send({ error: 'too many concurrent stage runs — try again shortly' })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      try {
      // Create run record first so we have a runId for the Redis channel name
      const runRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at)
          VALUES (gen_random_uuid(), ${id}::uuid, ${tenantId}::uuid, ${stageId}, 'running', '{}'::jsonb, now())
          RETURNING id
        `,
      ).catch(() => [] as Array<{ id: string }>)

      const runId = runRows[0]?.id ?? null
      if (!runId) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'failed to create run record' })}\n\n`)
        reply.raw.end()
        releaseSlot()
        return
      }

      // Track children for this run so we can kill on disconnect or cancel
      activeRunChildren.set(runId, [])

      const trackChild = (child: ChildProcess): ChildProcess => {
        if (runId) {
          const list = activeRunChildren.get(runId) ?? []
          list.push(child)
          activeRunChildren.set(runId, list)
          child.once('exit', () => {
            const current = activeRunChildren.get(runId ?? '') ?? []
            activeRunChildren.set(runId ?? '', current.filter(c => c !== child))
          })
        }
        return child
      }

      let sse: (data: object) => void
      let redisCleaned = false
      let cleanRedis: () => Promise<void> = async () => {
        if (redisCleaned) return
        redisCleaned = true
      }
      const redisUrl = process.env['REDIS_URL']

      if (redisUrl && runId) {
        try {
          const channel = `sse:run:${runId}`
          const pub = createClient({ url: redisUrl }) as RedisClientType
          await pub.connect()
          const sub = pub.duplicate()
          await sub.connect()
          await sub.subscribe(channel, (message, _channel) => {
            reply.raw.write(`data: ${message}\n\n`)
          })
          cleanRedis = async () => {
            if (redisCleaned) return
            redisCleaned = true
            try { await sub.unsubscribe(channel) } catch {}
            try { await sub.quit() } catch {}
            try { await pub.quit() } catch {}
          }
          request.raw.on('close', async () => {
            if (runId) killRunChildren(runId)
            await cleanRedis()
          })
          sse = (data: object) => { void pub.publish(channel, JSON.stringify(data)) }
        } catch (err) {
          request.log.warn({ err }, 'pipeline Redis fan-out failed — falling back to direct stream')
          try { await cleanRedis() } catch {}
          sse = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
        }
      } else {
        request.raw.on('close', () => { if (runId) killRunChildren(runId) })
        sse = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      const finishRun = async (status: string, output: object) => {
        if (!runId) return
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            UPDATE pipeline_stage_runs
            SET status = ${status}, output = ${JSON.stringify(output)}::jsonb, finished_at = now()
            WHERE id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid
          `,
        ).catch(() => null)
        const pipelineStatus = status === 'failed' ? 'failed' : status === 'waiting' ? 'waiting' : 'running'
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            UPDATE pipelines SET status = ${pipelineStatus}, updated_at = now()
            WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          `,
        ).catch(() => null)
      }

      sse({ type: 'started', stageId, runId })

      try {
        const stageType = stage['type'] as string
        // Real stage rows only ever set `label` (confirmed live: `deploy-prod`'s stage
        // object has id/type/label, no `name`) — `stage['name']` was always undefined.
        const stageName = (stage['label'] as string | undefined) ?? (stage['name'] as string | undefined) ?? stageId
        const envLabel = stage['envLabel'] as string | undefined
        const tfEnv = (stage['tfEnv'] as string | undefined) ?? 'demo'

        switch (stageType) {
          case 'build': {
            const pipelineMeta = (pipelines[0] as Record<string, unknown>)['metadata'] as Record<string, unknown> | undefined
            const gitSha = (pipelineMeta?.['gitSha'] as string | undefined)
              ?? input
              ?? process.env['GITHUB_SHA']
              ?? resolveGitSha()

            const registry = process.env['DOCKER_REGISTRY'] ?? ''
            const githubToken = process.env['GITHUB_TOKEN'] ?? ''
            const githubRepo = process.env['GITHUB_REPO'] ?? ''

            // Strategy A: trigger GitHub Actions workflow_dispatch if configured
            if (githubToken && githubRepo) {
              sse({ type: 'status', message: `Triggering CI build for ${gitSha}…` })
              const dispatchResp = await fetch(
                `https://api.github.com/repos/${githubRepo}/actions/workflows/ci.yml/dispatches`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${githubToken}`,
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ ref: 'main', inputs: { sha: gitSha } }),
                }
              )
              if (!dispatchResp.ok) {
                const err = await dispatchResp.text()
                throw new Error(`GitHub Actions dispatch failed: ${err}`)
              }
              sse({ type: 'log', line: `✓ CI workflow triggered for ${gitSha} — images will be pushed to ${registry || 'ghcr.io'}` })
              sse({ type: 'log', line: 'ℹ Workflow runs asynchronously — gate stage will confirm readiness before deploy' })
              const buildSummary = `Build triggered via GitHub Actions (${gitSha})`
              await finishRun('done', { summary: buildSummary, gitSha, strategy: 'github_actions' })
              sse({ type: 'done', output: { summary: buildSummary } })
              break
            }

            // Strategy B: docker build locally if DOCKER_REGISTRY is configured
            if (registry) {
              const gatewayImage = `${registry}/anway-gateway:${gitSha}`
              const webImage = `${registry}/anway-web:${gitSha}`
              sse({ type: 'status', message: `Building images for ${gitSha}…` })

              for (const [appDir, image] of [['apps/gateway', gatewayImage], ['apps/web', webImage]] as const) {
                // Build context must be the repo root, not the app subdirectory —
                // both Dockerfiles COPY sibling workspace packages (packages/*,
                // connectors/*) that live outside apps/gateway or apps/web, which
                // Docker cannot reach if the context is scoped to that subdirectory
                // (confirmed live: "connectors/argocd/package.json: not found" once
                // the context path itself was resolving correctly). Only the
                // Dockerfile's own path stays scoped to the app subdirectory.
                sse({ type: 'log', line: `→ docker build . -f ${appDir}/Dockerfile -t ${image}` })
                await new Promise<void>((resolve, reject) => {
                  const child = trackChild(spawn('docker', ['build', '.', '-t', image, '-f', `${appDir}/Dockerfile`], {
                    cwd: REPO_ROOT,
                    stdio: ['ignore', 'pipe', 'pipe'],
                  }))
                  child.stdout!.on('data', (d: Buffer) => sse({ type: 'log', line: d.toString().trim() }))
                  child.stderr!.on('data', (d: Buffer) => sse({ type: 'log', line: d.toString().trim() }))
                  child.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(`docker build failed (${code})`)))
                  child.on('error', reject)
                  // 600s (10min) was too tight — confirmed live, a cold build of this
                  // monorepo (35+ connector packages, each its own tsc build inside the
                  // Dockerfile) was still only ~20% through the connector list at 263s.
                  setTimeout(() => { child.kill(); reject(new Error('docker build timed out')) }, 1_800_000)
                })
                await new Promise<void>((resolve, reject) => {
                  const child = trackChild(spawn('docker', ['push', image], { stdio: ['ignore', 'pipe', 'pipe'] }))
                  child.stdout!.on('data', (d: Buffer) => sse({ type: 'log', line: d.toString().trim() }))
                  child.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(`docker push failed (${code})`)))
                  child.on('error', reject)
                  setTimeout(() => { child.kill(); reject(new Error('docker push timed out')) }, 300_000)
                })
                sse({ type: 'log', line: `✓ Pushed ${image}` })
              }

              // Store imageTag in pipeline metadata for the deploy stage to pick up
              await withTenant(prisma, tenantId, (tx) =>
                tx.$queryRaw`
                  UPDATE pipelines
                  SET metadata = metadata || ${JSON.stringify({ imageTag: gitSha })}::jsonb
                  WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
                `
              ).catch(() => null)

              const buildSummary = `Built and pushed ${gitSha} to ${registry}`
              await finishRun('done', { summary: buildSummary, gitSha, registry })
              sse({ type: 'done', output: { summary: buildSummary } })
              break
            }

            // No real build infra configured — fail explicitly instead of fabricating success
            sse({ type: 'status', message: 'Build failed: DOCKER_REGISTRY and GITHUB_TOKEN not configured — cannot build' })
            const errMsg = 'DOCKER_REGISTRY and GITHUB_TOKEN not configured — cannot build images'
            await finishRun('failed', { summary: errMsg, gitSha })
            sse({ type: 'error', message: errMsg })
            // Abort the pipeline so subsequent stages don't run on a failed build.
            // sse() fans out via Redis pub/sub (fire-and-forget publish) when
            // REDIS_URL is set — give the round-trip a moment to land before
            // ending the stream, or this terminal frame is silently dropped.
            // NOTE: 150ms is an empirical mitigation for typical local Redis
            // latency, not a guarantee — it can still race under load, network
            // jitter, or a slower environment. If this ever flakes, replace
            // with an ack-based mechanism (e.g. await pub.publish's resolved
            // subscriber count, or a dedicated ack channel) rather than a
            // longer guess.
            await new Promise(r => setTimeout(r, 150))
            return reply.raw.end()
            break
          }

          case 'tests': {
            sse({ type: 'status', message: 'Running type checks…' })
            let passed = 0
            let failed = 0

            for (const [label, tsconfig] of [
              ['gateway', 'apps/gateway/tsconfig.json'],
              ['web', 'apps/web/tsconfig.json'],
            ] as const) {
              sse({ type: 'log', line: `→ tsc --noEmit (${label})` })
              const result = await new Promise<{ code: number; output: string }>((resolve) => {
                let out = ''
                const child = trackChild(spawn('npx', ['tsc', '--noEmit', '-p', tsconfig], {
                  cwd: REPO_ROOT,
                  stdio: ['ignore', 'pipe', 'pipe'],
                }))
                child.stdout!.on('data', (d: Buffer) => { out += d.toString() })
                child.stderr!.on('data', (d: Buffer) => { out += d.toString() })
                child.on('close', (code: number) => resolve({ code: code ?? 1, output: out }))
                child.on('error', (err) => resolve({ code: 1, output: err.message }))
                setTimeout(() => { child.kill(); resolve({ code: 1, output: 'tsc timed out' }) }, 120_000)
              })
              if (result.code === 0) {
                passed++
                sse({ type: 'log', line: `✓ ${label}: 0 errors` })
              } else {
                failed++
                for (const line of result.output.split('\n').filter(Boolean).slice(0, 20)) {
                  sse({ type: 'log', line: `✗ ${line}` })
                }
              }
            }

            if (failed > 0) {
              await finishRun('failed', { summary: `Type check failed: ${failed} workspace(s) have errors`, passed, failed })
              sse({ type: 'done', output: { summary: `Type check failed — ${failed} error(s)` } })
            } else {
              await finishRun('done', { summary: `Type checks passed (${passed}/2 workspaces)`, passed, failed })
              sse({ type: 'done', output: { summary: `Type checks passed` } })
            }
            break
          }

          case 'deploy': {
            // Gate enforcement: if the pipeline has a gate-<env> stage preceding this deploy,
            // it must have been approved before we allow execution.
            // Real stage rows (e.g. this pipeline's `deploy-prod`/`deploy-staging`) never set
            // an `env` field — confirmed live, `stage['env']` is always undefined here, which
            // made this whole block dead code and let `deploy-prod` run with zero gate check.
            // Derive env from the stage id itself instead (`deploy-<env>` -> `<env>`), and match
            // the real gate stage id convention (hyphen, e.g. `gate-prod`), not `gate.<env>`.
            const deployEnv = (stage['env'] as string | undefined)
              ?? (typeof stage['id'] === 'string' ? (stage['id'] as string).replace(/^deploy-/, '') : undefined)
            const gateStageId = deployEnv ? `gate-${deployEnv}` : null
            if (gateStageId) {
              const hasGateStage = stages.some(s => s['id'] === gateStageId)
              if (hasGateStage) {
                // Atomically consume the gate before deploy starts — prevents concurrent deploys
                // both seeing 'approved' and proceeding before either marks it consumed.
                const consumed = await withTenant(prisma, tenantId, (tx) =>
                  tx.$executeRaw`
                    UPDATE pipeline_stage_runs SET status = 'consumed', finished_at = now()
                    WHERE pipeline_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
                      AND stage_id = ${gateStageId} AND status = 'approved'
                  `
                ).catch(() => 0)
                if (Number(consumed) === 0) {
                  sse({ type: 'error', message: `Gate ${gateStageId} must be approved before deploying to ${deployEnv}` })
                  await finishRun('failed', { error: 'gate_required', gateStageId })
                  break
                }
              }
            }

            const pipelineMeta = (pipelines[0] as Record<string, unknown>)['metadata'] as Record<string, unknown> | undefined
            const imageTag = (pipelineMeta?.['imageTag'] as string | undefined)
              ?? (input && !['fail','failed'].includes(input) ? input : undefined)
              ?? process.env['DEPLOY_IMAGE_TAG']
              ?? resolveGitSha()

            // Derive namespace from stage ID or pipeline metadata
            const helmNamespace = (pipelineMeta?.['namespace'] as string | undefined)
              ?? (stageId.includes('prod') || (envLabel ?? '').toLowerCase().includes('prod')
                  ? (process.env['HELM_NAMESPACE_PROD'] ?? 'anway')
                  : (process.env['HELM_NAMESPACE_STAGING'] ?? 'anway-staging'))

            const helmRelease = process.env['HELM_RELEASE'] ?? 'anway'
            const helmChart = process.env['HELM_CHART'] ?? 'infra/helm/anway'
            const registry = process.env['DOCKER_REGISTRY'] ?? ''
            const { path: kubeconfig, cleanup: kubeconfigCleanup } = await resolveKubeconfigPath(tenantId)

            if (!kubeconfig) {
              // No K8s connector — fail explicitly instead of fabricating success.
              // sse() fans out via Redis pub/sub (fire-and-forget publish) when
              // REDIS_URL is set — give the round-trip a moment to land before
              // ending the stream, or this terminal frame is silently dropped.
              // NOTE: 150ms is an empirical mitigation for typical local Redis
              // latency, not a guarantee — it can still race under load, network
              // jitter, or a slower environment. If this ever flakes, replace
              // with an ack-based mechanism (e.g. await pub.publish's resolved
              // subscriber count, or a dedicated ack channel) rather than a
              // longer guess.
              sse({ type: 'status', message: 'Deploy failed: no KUBECONFIG — register a K8s/eks/gke connector to enable real deploys' })
              await finishRun('failed', { summary: 'No KUBECONFIG configured — cannot deploy', imageTag })
              sse({ type: 'error', message: 'No KUBECONFIG configured — cannot deploy' })
              await new Promise(r => setTimeout(r, 150))
              return reply.raw.end()
              break
            }

            sse({ type: 'status', message: `Deploying ${imageTag} to ${helmNamespace}…` })

            // ANWAY_ENCRYPTION_KEY is required at gateway boot (zod-validated, throws
            // if empty) — forward this environment's real key so the deployed pod
            // doesn't crash-loop. JWT_SECRET must be >=32 chars in production
            // (assertSecureJwtSecret) — this environment's dev default
            // ("dev-secret-change-in-production") is only 31 chars and fails that
            // check under NODE_ENV=production, so generate a secure one instead of
            // forwarding a value that's guaranteed to crash-loop the pod (confirmed
            // live: "Production requires ... JWT_SECRET >=32 chars").
            const vaultSecrets = await fetchGatewaySecretsFromVault(tenantId)
            if (vaultSecrets) {
              sse({ type: 'log', line: '→ Sourcing gateway secrets from registered Vault connector (secret/anway/gateway)' })
            }
            const encryptionKey = vaultSecrets?.encryptionKey ?? process.env['ANWAY_ENCRYPTION_KEY'] ?? ''
            const rawJwtSecret = vaultSecrets?.jwtSecret ?? process.env['JWT_SECRET'] ?? ''
            const jwtSecret = rawJwtSecret.length >= 32 ? rawJwtSecret : randomBytes(32).toString('base64')
            if (!encryptionKey) {
              sse({ type: 'status', message: 'Warning: ANWAY_ENCRYPTION_KEY not set in this environment — deployed gateway will crash-loop unless HELM_SET_ANWAY_ENCRYPTION_KEY is provided separately' })
            }

            const helmArgs = [
              'upgrade', '--install', helmRelease, helmChart,
              '--namespace', helmNamespace,
              '--create-namespace',
              '--wait',
              '--timeout', '10m',
              '--set', `image.gateway.tag=${imageTag}`,
              '--set', `image.web.tag=${imageTag}`,
              ...(registry ? [
                '--set', `image.gateway.repository=${registry}/anway-gateway`,
                '--set', `image.web.repository=${registry}/anway-web`,
              ] : []),
              ...(encryptionKey ? ['--set-string', `gateway.secrets.ANWAY_ENCRYPTION_KEY=${encryptionKey}`] : []),
              ...(jwtSecret ? ['--set-string', `gateway.secrets.JWT_SECRET=${jwtSecret}`] : []),
            ]

            sse({ type: 'log', line: `→ helm ${helmArgs.join(' ')}` })

            await new Promise<void>((resolve, reject) => {
              const child = trackChild(spawn('helm', helmArgs, {
                cwd: REPO_ROOT,
                env: { ...process.env, KUBECONFIG: kubeconfig },
                stdio: ['ignore', 'pipe', 'pipe'],
              }))
              child.stdout!.on('data', (d: Buffer) => {
                for (const line of d.toString().split('\n').filter(Boolean)) {
                  sse({ type: 'log', line })
                }
              })
              child.stderr!.on('data', (d: Buffer) => {
                for (const line of d.toString().split('\n').filter(Boolean)) {
                  sse({ type: 'log', line })
                }
              })
              child.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(`helm exited ${code}`)))
              child.on('error', reject)
              setTimeout(() => { child.kill(); reject(new Error('helm timed out after 600s')) }, 600_000)
            })

            // Run prisma migrate after deploy
            sse({ type: 'log', line: '→ Running database migrations…' })
            await new Promise<void>((resolve) => {
              const migratePodName = `migrate-${Date.now()}`
              const migrateImage = `${registry ? `${registry}/anway-gateway` : 'anway-gateway'}:${imageTag}`
              // kubectl run's generated pod carries no DATABASE_URL and no
              // `app: {release}-gateway` label — without both, this job fails
              // (confirmed live: "Environment variable not found: DATABASE_URL")
              // and, once fixed, would still be blocked by the default-deny
              // NetworkPolicy's egress rule, which is scoped to that label.
              // --overrides reuses the exact same secret/configmap the real
              // gateway deployment reads via envFrom, and borrows its label so
              // this ad-hoc pod inherits the same egress allow-rule to postgres.
              const overrides = {
                apiVersion: 'v1',
                metadata: { labels: { app: `${helmRelease}-gateway` } },
                spec: {
                  containers: [{
                    name: migratePodName,
                    image: migrateImage,
                    command: ['npx', 'prisma', 'migrate', 'deploy'],
                    envFrom: [
                      { secretRef: { name: `${helmRelease}-gateway-secrets` } },
                      { configMapRef: { name: `${helmRelease}-gateway-config` } },
                    ],
                  }],
                },
              }
              const child = trackChild(spawn('kubectl', [
                'run', migratePodName,
                '--image', migrateImage,
                '--namespace', helmNamespace,
                '--restart=Never', '--rm', '--attach',
                '--overrides', JSON.stringify(overrides),
              ], {
                env: { ...process.env, KUBECONFIG: kubeconfig },
                stdio: ['ignore', 'pipe', 'pipe'],
              }))
              child.stdout!.on('data', (d: Buffer) => sse({ type: 'log', line: d.toString().trim() }))
              child.stderr!.on('data', (d: Buffer) => sse({ type: 'log', line: d.toString().trim() }))
              child.on('close', () => resolve())
              child.on('error', () => resolve())
            })

            const deploySummary = `Deployed ${imageTag} to ${helmNamespace}`
            await finishRun('done', { summary: deploySummary, imageTag, namespace: helmNamespace })
            sse({ type: 'done', output: { summary: deploySummary } })
            kubeconfigCleanup()
            break
          }

          case 'monitor': {
            // Real health check if K8s connector configured, else use metrics from DB
            const { path: kubeconfig, cleanup: kubeconfigCleanup2 } = await resolveKubeconfigPath(tenantId)
            const pipelineMeta2 = (pipelines[0] as Record<string, unknown>)['metadata'] as Record<string, unknown> | undefined
            const monitorNamespace = (pipelineMeta2?.['namespace'] as string | undefined)
              ?? (stageId.includes('prod') ? (process.env['HELM_NAMESPACE_PROD'] ?? 'anway') : (process.env['HELM_NAMESPACE_STAGING'] ?? 'anway-staging'))
            const healthUrl = process.env[`HEALTH_URL_${monitorNamespace.toUpperCase().replace(/-/g, '_')}`]

            let monitorOk = true
            let monitorDetails: string[] = []

            if (kubeconfig) {
              // Poll kubectl rollout status
              sse({ type: 'log', line: `→ kubectl rollout status deployment/anway-gateway -n ${monitorNamespace}` })
              const rolloutResult = await new Promise<{ code: number; output: string }>((resolve) => {
                let out = ''
                const child = spawn('kubectl', [
                  'rollout', 'status', 'deployment/anway-gateway',
                  '-n', monitorNamespace, '--timeout=120s',
                ], { env: { ...process.env, KUBECONFIG: kubeconfig }, stdio: ['ignore', 'pipe', 'pipe'] })
                child.stdout.on('data', (d: Buffer) => { out += d.toString() })
                child.stderr.on('data', (d: Buffer) => { out += d.toString() })
                child.on('close', (code: number) => resolve({ code: code ?? 1, output: out }))
                child.on('error', (err) => resolve({ code: 1, output: err.message }))
              })
              monitorOk = rolloutResult.code === 0
              monitorDetails.push(rolloutResult.output.trim() || (monitorOk ? '✓ Rollout complete' : '✗ Rollout failed'))
              sse({ type: 'log', line: monitorDetails[0]! })
            } else if (healthUrl) {
              sse({ type: 'log', line: `-> Polling ${healthUrl}` })
              let pollOk = false
              for (let attempt = 1; attempt <= 12; attempt++) {
                try {
                  const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) })
                  if (resp.ok) {
                    sse({ type: 'log', line: `OK ${healthUrl} -- ${resp.status} (attempt ${attempt}/12)` })
                    pollOk = true
                    break
                  }
                  sse({ type: 'log', line: `FAIL ${healthUrl} -- ${resp.status} (attempt ${attempt}/12)` })
                } catch (err) {
                  sse({ type: 'log', line: `FAIL ${healthUrl} -- ${err instanceof Error ? err.message : String(err)} (attempt ${attempt}/12)` })
                }
                await new Promise(r => setTimeout(r, 5000))
              }
              monitorOk = pollOk
              monitorDetails = [pollOk ? `OK ${healthUrl} healthy` : `FAIL ${healthUrl} failed after 12 attempts`]
              sse({ type: 'log', line: monitorDetails[0]! })
            } else {
              // No KUBECONFIG — query entity DB for lightweight service-status check
              sse({ type: 'log', line: 'Monitor stage: no KUBECONFIG configured — checking service entities from DB' })
              const metrics = await withTenant(prisma, tenantId, (tx) =>
                tx.$queryRaw<Array<{ name: string }>>`SELECT name FROM entities WHERE type = 'Service' LIMIT 3`
              ).catch(() => [])
              sse({ type: 'log', line: `→ Service entities tracked: ${metrics.length}` })
              monitorDetails = [`${metrics.length} service entities found — set KUBECONFIG for real metrics`]
            }

            const monitorSummary = monitorOk
              ? `${envLabel ?? stageId} stable — ${monitorDetails.join('; ')}`
              : `${envLabel ?? stageId} health check failed`

            // Check if monitor stage reports failure (external systems may signal via input)
            const monitorFailed = !monitorOk || input === 'fail' || input === 'failed'
            if (monitorFailed) {
              const pipelineMeta = (pipelines[0] as Record<string, unknown>)['metadata'] as Record<string, unknown> | undefined
              const prevState = pipelineMeta?.['previousTfState']

              await finishRun('failed', { summary: `Monitor failed for ${envLabel ?? stageId}` })
              sse({ type: 'done', output: { summary: `Monitor failed for ${envLabel ?? stageId}` } })

              if (prevState) {
                  // Always require L2 gate in V1 — all write actions need explicit user confirmation
                  const rollbackUserId = (request.user as { sub: string }).sub
                  await withTenant(prisma, tenantId, (tx) =>
                    tx.$executeRaw`
                      INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, created_at)
                      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${rollbackUserId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, ${'pipeline_rollback'}, ${JSON.stringify({ pipelineId: id, stageId: 'rollback', reason: 'monitor_failed' })}::jsonb, ${'pipeline'}, 'pending', now())
                    `
                  ).catch(() => null)
                  // Emit gate event to SSE
                  await withTenant(prisma, tenantId, (tx) =>
                    tx.$executeRaw`
                      INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at)
                      VALUES (gen_random_uuid(), ${id}::uuid, ${tenantId}::uuid, 'rollback', 'waiting',
                        '{"type":"rollback","reason":"monitor_failed","gate_required":true}'::jsonb, now())
                    `
                  ).catch(() => null)
                  sse({ type: 'gate_required', message: 'Rollback approval required — monitor failed', stageId: 'rollback' })
              } else {
                sse({ type: 'status', message: 'No previous terraform state to rollback to' })
              }
            } else {
              await finishRun('done', { summary: monitorSummary })
              sse({ type: 'done', output: { summary: monitorSummary } })
            }
            kubeconfigCleanup2()
            break
          }

          case 'gate': {
            const gateUserId = (request.user as { sub: string }).sub
            await withTenant(prisma, tenantId, (tx) =>
              tx.$queryRaw`
                INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, created_at)
                VALUES (gen_random_uuid(), ${tenantId}::uuid, ${gateUserId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, ${'pipeline_promote'}, ${JSON.stringify({ pipelineId: id, stageId, runId })}::jsonb, ${'pipeline'}, 'pending', now())
              `,
            ).catch(() => null)

            const pipelineName = (pipelines[0] as Record<string, unknown>)['name'] as string ?? 'unknown'
            const slackConfig = await withTenant(prisma, tenantId, (tx) =>
              tx.$queryRaw<{ credentials_enc: string }[]>`
                SELECT credentials_enc FROM connector_config WHERE tenant_id = ${tenantId}::uuid AND connector_type = 'slack' AND enabled = true LIMIT 1
              `
            ).catch(() => [])

            if (slackConfig.length > 0) {
              try {
                const creds = decryptJson(slackConfig[0]!.credentials_enc) as { webhookUrl?: string; botToken?: string; channel?: string }
                if (creds.webhookUrl) {
                  await fetch(creds.webhookUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      text: `🚦 Gate pending approval`,
                      blocks: [
                        { type: 'section', text: { type: 'mrkdwn', text: `*Gate requires approval*\nPipeline: ${pipelineName}\nStage: ${stageName}\nTriggered by: ${(request.user as { email?: string }).email ?? 'unknown'}` } },
                        { type: 'section', text: { type: 'mrkdwn', text: `Approve in Anway → Pipeline view → Gate: ${stageId}` } }
                      ]
                    })
                  }).catch(() => { /* non-blocking */ })
                }
              } catch { /* non-blocking — no Slack never breaks gate */ }
            }

            sse({ type: 'gate_required', message: `${stageName} — approval required to promote` })
            await finishRun('waiting', { message: 'Waiting for promotion approval' })
            break
          }

          case 'rollback': {
            sse({ type: 'log', line: 'Rollback stage requires approval' })
            const pipelineMeta = (pipelines[0] as Record<string, unknown>)['metadata'] as Record<string, unknown> | undefined
            const prevState = pipelineMeta?.['previousTfState']
            if (prevState) {
              // V1: ALL write actions require explicit user confirmation — no auto-proceed
              const rollbackUserId = (request.user as { sub: string }).sub
              await withTenant(prisma, tenantId, (tx) =>
                tx.$executeRaw`
                  INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, created_at)
                  VALUES (gen_random_uuid(), ${tenantId}::uuid, ${rollbackUserId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, ${'pipeline_rollback'}, ${JSON.stringify({ pipelineId: id, stageId: 'rollback', reason: 'manual' })}::jsonb, ${'pipeline'}, 'pending', now())
                `
              ).catch(() => null)
              await withTenant(prisma, tenantId, (tx) =>
                tx.$executeRaw`
                  INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at)
                  VALUES (gen_random_uuid(), ${id}::uuid, ${tenantId}::uuid, 'rollback', 'waiting',
                    '{"type":"rollback","reason":"manual","gate_required":true}'::jsonb, now())
                `
              ).catch(() => null)
              sse({ type: 'gate_required', message: 'Rollback approval required', stageId: 'rollback' })
              await finishRun('waiting', { message: 'Waiting for rollback approval' })
            } else {
              sse({ type: 'status', message: 'No previous terraform state to rollback to' })
              const summary = 'Rollback skipped — no previous state'
              await finishRun('done', { summary })
              sse({ type: 'done', output: { summary } })
            }
            break
          }

          default: {
            sse({ type: 'status', message: `Running ${stageName}…` })
            await new Promise(r => setTimeout(r, 500))
            const inputSummary = input ? `Completed: ${input}` : `${stageName} stage completed`
            await finishRun('done', { summary: inputSummary })
            sse({ type: 'done', output: { summary: inputSummary } })
          }
        }
      } catch (err) {
        await finishRun('failed', { error: String(err) })
        sse({ type: 'error', message: String(err) })
      } finally {
        // Some stage branches above (e.g. build/deploy with missing config)
        // already call `return reply.raw.end()` before falling through to this
        // finally block. Writing/ending again on an already-ended stream throws
        // ERR_STREAM_WRITE_AFTER_END as an uncaught exception and crashes the
        // whole gateway process — guard on writableEnded first.
        if (!reply.raw.writableEnded) {
          // Flush terminal frame directly before Redis teardown to prevent drop
          reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        }
        await cleanRedis()
        releaseSlot()
        if (runId) activeRunChildren.delete(runId)
      }

      // Give Redis pub/sub time to deliver the final SSE event before closing
      await new Promise(r => setTimeout(r, 150))
      if (!reply.raw.writableEnded) reply.raw.end()
      } finally {
        releaseSlot()
      }
    },
  )

  // POST /api/pipelines/runs/:runId/cancel — kill a running stage
  app.post<{ Params: { runId: string } }>(
    '/api/pipelines/runs/:runId/cancel',
    { preHandler: [app.authenticate, requireRole('admin', 'sre', 'dev')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { runId } = request.params

      // Verify the run belongs to this tenant
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM pipeline_stage_runs
          WHERE id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
        `
      ).catch(() => [] as Array<{ id: string; status: string }>)

      if (rows.length === 0) return reply.code(404).send({ error: 'run not found' })
      if (rows[0]!.status !== 'running') return reply.code(409).send({ error: 'run is not in progress' })

      killRunChildren(runId)

      await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          UPDATE pipeline_stage_runs
          SET status = 'cancelled', finished_at = now()
          WHERE id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'running'
        `
      ).catch(() => null)

      return reply.send({ ok: true, runId, status: 'cancelled' })
    },
  )

  // POST /api/pipelines/:id/stages/:stageId/approve
  app.post<{ Params: { id: string; stageId: string }; Body: { changeTicketUrl?: string } }>(
    '/api/pipelines/:id/stages/:stageId/approve',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id, stageId } = request.params

      // Check gate policy for change ticket requirement
      // Order by specificity: stage-level > pipeline-level > global ('*')
      const policies = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ require_change_ticket: boolean; id: string }>>`
          SELECT require_change_ticket, id FROM gate_policies
          WHERE tenant_id = ${tenantId}::uuid
          AND (scope = '*' OR scope = ${stageId} OR scope = ${id})
          ORDER BY CASE WHEN scope = ${stageId} THEN 0 WHEN scope = ${id} THEN 1 ELSE 2 END
          LIMIT 1
        `
      ).catch(() => [] as { require_change_ticket: boolean }[])

      if (policies[0]?.require_change_ticket) {
        const { changeTicketUrl } = request.body ?? {}
        if (!changeTicketUrl) {
          return reply.code(400).send({ error: 'change ticket required', code: 'CHANGE_TICKET_REQUIRED' })
        }
        // Store change ticket URL on pipeline metadata
        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            UPDATE pipelines
            SET metadata = metadata || ${JSON.stringify({ changeTicketUrl })}::jsonb
            WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          `
        ).catch(() => null)
      }

      // SoD: requester cannot approve their own gate
      // Scope to a specific gate event ID to avoid concurrent approval race
      const gateRequestRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ user_id: string | null; id: string }>>`
          SELECT id, user_id FROM gate_events
          WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'
            AND tool_args->>'pipelineId' = ${id}
            AND tool_args->>'stageId' = ${stageId}
          ORDER BY created_at DESC LIMIT 1
        `
      ).catch(() => [] as Array<{ user_id: string | null; id: string }>)
      const requesterId = gateRequestRows[0]?.user_id ?? null
      const gateEventId = gateRequestRows[0]?.id ?? null
      const approverId = (request.user as { sub: string }).sub
      // Fail closed: no requester row means we cannot verify SoD — deny approval
      if (requesterId === null || gateEventId === null) {
        return reply.code(409).send({ error: 'gate request not found or already decided' })
      }
      if (requesterId === approverId) {
        return reply.code(403).send({ error: 'cannot approve your own gate request' })
      }

      // Merge stage_run UPDATE, gate_event UPDATE, and audit insert into a single transaction
      await withTenant(prisma, tenantId, async (tx) => {
        await tx.$queryRaw`
          UPDATE pipeline_stage_runs
          SET status = 'approved', finished_at = now()
          WHERE pipeline_id = ${id}::uuid AND stage_id = ${stageId}
            AND tenant_id = ${tenantId}::uuid AND status = 'waiting'
        `
        await tx.$queryRaw`
          UPDATE gate_events SET status = 'approved', decided_by = ${approverId}::uuid, decided_at = now()
          WHERE id = ${gateEventId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
        `
        await tx.$executeRaw`
          INSERT INTO audit_events (id, tenant_id, user_id, event_type, payload, created_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${approverId}::uuid, 'gate_approved',
            ${JSON.stringify({ pipelineId: id, stageId, decidedBy: (request.user as { email?: string }).email ?? 'unknown' })}::jsonb, NOW())
        `
      }).catch(() => null)

      return reply.send({ approved: true })
    },
  )

  // DELETE /api/pipelines/:id
  app.delete<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id } = request.params

      await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          DELETE FROM pipeline_stage_runs WHERE pipeline_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
        `,
      ).catch(() => null)

      await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          DELETE FROM pipelines WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
        `,
      ).catch(() => null)

      return reply.send({ deleted: true })
    },
  )
}
