import type { ExecutableTool, IModelProvider, IKnowledgeGraph } from '@anway/agent'
import { DeployAgent } from '@anway/agent'
import { TenantId } from '@anway/types'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { decideGate } from '../gate/decide-gate.js'

export function makeDeployTools(
  tenantId: string,
  userId: string,
  role: string,
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
          service: { type: 'string', description: 'Service name to deploy (e.g. "payments-api", "anway-gateway")' },
          environment: { type: 'string', enum: ['staging', 'preprod', 'prod'], description: 'Target environment' },
          sha: { type: 'string', description: 'Git SHA or image tag to deploy. Omit to use latest.' },
        },
        required: ['service', 'environment'],
      },
      async run(args: Record<string, unknown>) {
        const service = args['service'] as string
        const environment = args['environment'] as string
        const sha = (args['sha'] as string | undefined) ?? process.env['GITHUB_SHA'] ?? 'latest'

        let plan: import('@anway/agent').DeployPlan | null = null
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
                OR name = 'anway-self-deploy'
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
        // Approving a gate is itself a privileged write action — confirmed
        // live via independent review that this tool previously had no role
        // check at all (any authenticated user, including 'dev', could
        // approve a colleague's pending deploy/scale/restart gate) and
        // duplicated a simplified, diverging copy of the gate-decision logic
        // that bypassed gate_policies.approvers_required entirely and never
        // wrote an audit_events row. Now delegates to the same decideGate()
        // used by the dedicated /api/gate/:gateId/decide route so both paths
        // enforce identical role/SoD/multi-approver/audit semantics.
        if (role !== 'admin' && role !== 'sre') {
          return { error: 'Approving a gate requires admin or sre role.' }
        }

        const gateId = args['gate_id'] as string
        const reason = (args['reason'] as string | undefined) ?? 'Approved via chat'

        const result = await decideGate(tenantId, userId, gateId, 'approved')
        if (!result.ok) {
          return { error: result.error }
        }

        return {
          ok: true,
          gateId,
          status: result.decision,
          fullyApproved: result.fullyApproved,
          votesReceived: result.votesReceived,
          votesRequired: result.votesRequired,
          reason,
          message: result.fullyApproved
            ? 'Gate approved. Next pipeline stage will run automatically.'
            : `Vote recorded (${result.votesReceived}/${result.votesRequired} approvals) — waiting on additional approver(s).`,
        }
      },
    },
  ]
}
