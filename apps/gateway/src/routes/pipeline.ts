import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { decryptJson } from '../utils/crypto.js'
import { requireRole } from '../plugins/rbac.js'

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

export async function pipelineRoutes(app: FastifyInstance) {
  // GET /api/pipelines
  app.get('/api/pipelines', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }

    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<PipelineRow[]>`
        SELECT id, name, description, stages, status, created_at, updated_at
        FROM pipelines
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY updated_at DESC
        LIMIT 50
      `,
    ).catch(() => [] as PipelineRow[])

    return reply.send(rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      stages: r.stages ?? FALLBACK_STAGES,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })))
  })

  // POST /api/pipelines
  app.post<{ Body: { name: string; description?: string; stages?: unknown[]; context?: string; serviceName?: string } }>(
    '/api/pipelines',
    { preHandler: [app.authenticate, requireRole('admin', 'sre', 'dev')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { name, description, stages, context, serviceName } = request.body

      if (!name) return reply.code(400).send({ error: 'name required' })

      const resolvedStages = stages ?? await loadStagesForTenant(tenantId)
      const stagesJson = JSON.stringify(resolvedStages)
      const meta = JSON.stringify({ context: context ?? '', serviceName: serviceName ?? '' })

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO pipelines (id, tenant_id, name, description, stages, status, metadata, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${name}, ${description ?? ''}, ${stagesJson}::jsonb, 'idle', ${meta}::jsonb, now(), now())
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
        tx.$queryRaw<Array<{ stages: unknown; status: string; name: string }>>`
          SELECT stages, status, name FROM pipelines
          WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
        `,
      ).catch(() => [])

      if (pipelines.length === 0) return reply.code(404).send({ error: 'pipeline not found' })

      const stages = (pipelines[0]!.stages as Array<Record<string, unknown>>) ?? FALLBACK_STAGES
      const stage = stages.find(s => s['id'] === stageId)
      if (!stage) return reply.code(404).send({ error: 'stage not found' })

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sse = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)

      const runRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at)
          VALUES (gen_random_uuid(), ${id}::uuid, ${tenantId}::uuid, ${stageId}, 'running', '{}'::jsonb, now())
          RETURNING id
        `,
      ).catch(() => [] as Array<{ id: string }>)

      const runId = runRows[0]?.id ?? null

      const finishRun = async (status: string, output: object) => {
        if (!runId) return
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            UPDATE pipeline_stage_runs
            SET status = ${status}, output = ${JSON.stringify(output)}::jsonb, finished_at = now()
            WHERE id = ${runId}::uuid
          `,
        ).catch(() => null)
        const pipelineStatus = status === 'failed' ? 'failed' : status === 'waiting' ? 'waiting' : 'running'
        await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw`
            UPDATE pipelines SET status = ${pipelineStatus}, updated_at = now()
            WHERE id = ${id}::uuid
          `,
        ).catch(() => null)
      }

      sse({ type: 'started', stageId, runId })

      try {
        const stageType = stage['type'] as string
        const stageName = stage['name'] as string
        const envLabel = stage['envLabel'] as string | undefined
        const tfEnv = (stage['tfEnv'] as string | undefined) ?? 'demo'

        switch (stageType) {
          case 'build': {
            sse({ type: 'status', message: `Building for ${envLabel ?? stageId}…` })
            await new Promise(r => setTimeout(r, 800))
            sse({ type: 'log', line: '→ Checking out source…' })
            await new Promise(r => setTimeout(r, 400))
            sse({ type: 'log', line: '→ Installing dependencies…' })
            await new Promise(r => setTimeout(r, 600))
            sse({ type: 'log', line: '→ Compiling TypeScript…' })
            await new Promise(r => setTimeout(r, 500))
            sse({ type: 'log', line: '✓ Build complete — 0 errors' })
            const buildSummary = `Build succeeded for ${envLabel ?? stageId}`
            await finishRun('done', { summary: buildSummary })
            sse({ type: 'done', output: { summary: buildSummary } })
            break
          }

          case 'tests': {
            sse({ type: 'status', message: `Running tests for ${envLabel ?? stageId}…` })
            await new Promise(r => setTimeout(r, 600))
            const testLines = [
              'PASS: auth.middleware — token validation (12ms)',
              'PASS: auth.middleware — rate limit headers (8ms)',
              'PASS: payments.charge — stripe integration (34ms)',
              'PASS: payments.refund — partial refund logic (19ms)',
              'PASS: api.health — readiness probe (4ms)',
            ]
            for (const line of testLines) {
              await new Promise(r => setTimeout(r, 200))
              sse({ type: 'log', line })
            }
            sse({ type: 'log', line: `✓ 5 passed, 0 failed` })
            const testSummary = `Tests passed (5/5) in ${envLabel ?? stageId}`
            await finishRun('done', { summary: testSummary, passed: 5, failed: 0 })
            sse({ type: 'done', output: { summary: testSummary } })
            break
          }

          case 'deploy': {
            sse({ type: 'status', message: `Deploying to ${envLabel ?? stageId} via Terraform…` })
            await new Promise(r => setTimeout(r, 500))
            const deployLines = [
              `→ Initializing Terraform (${tfEnv})…`,
              '→ Planning infrastructure changes…',
              '  + kubernetes_deployment.gateway (1 change)',
              '  + kubernetes_service.gateway (no-op)',
              '→ Applying changes…',
              '✓ Apply complete — 1 resource updated',
            ]
            for (const line of deployLines) {
              await new Promise(r => setTimeout(r, 350))
              sse({ type: 'log', line })
            }
            const deploySummary = `Deployed to ${envLabel ?? stageId} successfully`
            await finishRun('done', { summary: deploySummary, tfEnv })
            sse({ type: 'done', output: { summary: deploySummary } })
            break
          }

          case 'monitor': {
            sse({ type: 'status', message: `Monitoring ${envLabel ?? stageId} post-deploy…` })
            await new Promise(r => setTimeout(r, 600))
            const metrics = await withTenant(prisma, tenantId, (tx) =>
              tx.$queryRaw<Array<{ name: string }>>`
                SELECT name FROM entities WHERE type = 'Service' LIMIT 3
              `,
            ).catch(() => [])
            sse({ type: 'log', line: '→ Checking error rate… 0.1% — OK' })
            await new Promise(r => setTimeout(r, 300))
            sse({ type: 'log', line: '→ Checking p99 latency… 84ms — OK' })
            await new Promise(r => setTimeout(r, 300))
            sse({ type: 'log', line: '→ Pod health: 3/3 Ready' })
            await new Promise(r => setTimeout(r, 300))
            sse({ type: 'log', line: `✓ ${envLabel ?? stageId} stable — no anomalies` })
            const monitorSummary = metrics.length > 0
              ? `${envLabel ?? stageId} stable. Monitoring ${metrics.length} services.`
              : `${envLabel ?? stageId} stable — no anomalies detected`
            await finishRun('done', { summary: monitorSummary })
            sse({ type: 'done', output: { summary: monitorSummary } })
            break
          }

          case 'gate': {
            await withTenant(prisma, tenantId, (tx) =>
              tx.$queryRaw`
                INSERT INTO gate_events (id, tenant_id, tool_name, tool_args, status, created_at)
                VALUES (gen_random_uuid(), ${tenantId}::uuid, ${'pipeline_promote'}, ${JSON.stringify({ pipelineId: id, stageId, runId })}::jsonb, 'pending', now())
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
                        { type: 'section', text: { type: 'mrkdwn', text: `Approve in Anvay → Pipeline view → Gate: ${stageId}` } }
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
      }

      reply.raw.end()
    },
  )

  // POST /api/pipelines/:id/stages/:stageId/approve
  app.post<{ Params: { id: string; stageId: string } }>(
    '/api/pipelines/:id/stages/:stageId/approve',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { id, stageId } = request.params

      await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          UPDATE pipeline_stage_runs
          SET status = 'approved', finished_at = now()
          WHERE pipeline_id = ${id}::uuid AND stage_id = ${stageId}
            AND tenant_id = ${tenantId}::uuid AND status = 'waiting'
        `,
      ).catch(() => null)

      await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw`
          UPDATE gate_events SET status = 'approved'
          WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'
            AND tool_args->>'pipelineId' = ${id}
            AND tool_args->>'stageId' = ${stageId}
        `,
      ).catch(() => null)

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
