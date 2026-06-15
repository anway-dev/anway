import type { ExecutableTool, IModelProvider, IKnowledgeGraph } from '@anvay/agent'
import { DeployAgent } from '@anvay/agent'
import { TenantId } from '@anvay/types'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

export function makeDeployTools(
  tenantId: string,
  userId: string,
  provider: IModelProvider,
  kg: IKnowledgeGraph,
): ExecutableTool[] {
  const deployAgent = new DeployAgent(provider, provider, kg)

  return [
    {
      name: 'trigger_pipeline',
      description: 'Trigger a deployment pipeline for a service to a target environment. Use when the user asks to deploy, release, or ship a service. Generates a deploy plan via the Deploy Agent then starts the pipeline build stage.',
      parameters: {
        type: 'object' as const,
        properties: {
          service: { type: 'string', description: 'Service name to deploy (e.g. "payments-api", "anvay-gateway")' },
          environment: { type: 'string', enum: ['staging', 'preprod', 'prod'], description: 'Target environment' },
          sha: { type: 'string', description: 'Git SHA or image tag to deploy. Omit to use latest.' },
        },
        required: ['service', 'environment'],
      },
      async run(args: Record<string, unknown>) {
        const service = args['service'] as string
        const environment = args['environment'] as string
        const sha = (args['sha'] as string | undefined) ?? process.env['GITHUB_SHA'] ?? 'latest'

        let plan: import('@anvay/agent').DeployPlan | null = null
        try {
          plan = await deployAgent.planDeploy(service, environment, sha, tenantId as TenantId)
        } catch { /* non-blocking */ }

        const pipelines = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ id: string; name: string; stages: unknown }>>`
            SELECT id, name, stages FROM pipelines
            WHERE tenant_id = ${tenantId}::uuid
              AND (
                name ILIKE ${'%' + service + '%'}
                OR metadata->>'serviceName' = ${service}
                OR name = 'anvay-self-deploy'
              )
            ORDER BY
              CASE WHEN name ILIKE ${'%' + service + '%'} THEN 0 ELSE 1 END,
              created_at DESC
            LIMIT 1
          `
        ).catch(() => [] as Array<{ id: string; name: string; stages: unknown }>)

        if (pipelines.length === 0) {
          return { error: `No pipeline found for service "${service}". Create one in the Pipelines view first.` }
        }

        const pipeline = pipelines[0]!

        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            UPDATE pipelines
            SET metadata = metadata || ${JSON.stringify({
              imageTag: sha,
              serviceName: service,
              targetEnv: environment,
              deployPlan: plan,
              triggeredBy: userId,
              triggeredAt: new Date().toISOString(),
            })}::jsonb,
                status = 'running',
                updated_at = now()
            WHERE id = ${pipeline.id}::uuid AND tenant_id = ${tenantId}::uuid
          `
        )

        const stages = (pipeline.stages as Array<{ id: string; type: string }>) ?? []
        const firstStage = stages[0]
        if (!firstStage) {
          return { error: 'Pipeline has no stages configured.' }
        }

        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at)
            VALUES (gen_random_uuid(), ${pipeline.id}::uuid, ${tenantId}::uuid, ${firstStage.id}, 'pending',
              ${JSON.stringify({ triggeredBy: 'orchestrator', service, environment, sha })}::jsonb, now())
            ON CONFLICT DO NOTHING
          `
        )

        return {
          ok: true,
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          firstStage: firstStage.id,
          imageTag: sha,
          environment,
          service,
          plan: plan ? {
            strategy: plan.strategy,
            estimatedDuration: plan.estimatedDuration,
            confidence: plan.confidence,
            preChecks: plan.preChecks,
          } : null,
          message: `Pipeline "${pipeline.name}" triggered for ${service} → ${environment} (${sha}). Build stage queued. Watch the Pipelines view for progress.`,
        }
      },
    },

    {
      name: 'approve_gate',
      description: 'Approve a pending deployment gate. Use when the user says "approve", "yes", "go ahead", "ship it" in response to a gate_required event. Requires the gateId from the gate event.',
      parameters: {
        type: 'object' as const,
        properties: {
          gate_id: { type: 'string', description: 'UUID of the gate event to approve' },
          reason: { type: 'string', description: 'Optional approval reason or comment' },
        },
        required: ['gate_id'],
      },
      async run(args: Record<string, unknown>) {
        const gateId = args['gate_id'] as string
        const reason = (args['reason'] as string | undefined) ?? 'Approved via chat'

        const rows = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ id: string; status: string }>>`
            UPDATE gate_events
            SET status = 'approved',
                tool_args = tool_args || ${JSON.stringify({ approvedBy: userId, reason, approvedAt: new Date().toISOString() })}::jsonb
            WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
            RETURNING id, status
          `
        ).catch(() => [])

        if (rows.length === 0) {
          return { error: `Gate ${gateId} not found or already resolved.` }
        }

        // Update Redis decision key so pollGate() unblocks the waiting orchestrator run
        const redisUrl = process.env['REDIS_URL']
        if (redisUrl) {
          try {
            const { createClient } = await import('redis')
            const redis = createClient({ url: redisUrl })
            await redis.connect()
            await redis.set(`gate:${gateId}:decision`, 'approved')
            await redis.disconnect()
          } catch { /* Redis may be unavailable — pollGate will timeout */ }
        }

        return { ok: true, gateId, status: 'approved', reason, message: 'Gate approved. Next pipeline stage will run automatically.' }
      },
    },
  ]
}
