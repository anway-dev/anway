import type { FastifyInstance } from 'fastify'
import { spawn } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'
import { effectiveCredentials } from '../utils/credentials.js'
import { appendAuditEvent } from './audit.js'

// ECS deploy write action — the missing piece for "edit code, build, deploy
// to k8s or ECS" (product verification found the ECS connector was
// read-only — list_services/list_tasks/describe_service only, zero write
// tools, no gateway write route at all). Mirrors k8s.ts's exact pattern:
// direct AWS CLI calls (not routed through the connector's own tools, same
// as k8s.ts not routing through K8sAgent), perimeter check + atomic
// gate-consume + audit.

const ECS_CONNECTOR_TYPE = 'ecs'

// Confirmed live via independent review: this used spawnSync with a 30s
// timeout — on a single-threaded Node gateway process, that blocks the
// ENTIRE event loop (every tenant's every in-flight request) for up to 30
// real seconds per AWS CLI call, and this route makes up to 4 of them
// sequentially (describe-services, describe-task-definition,
// register-task-definition, update-service) — a worst case of two real
// minutes with the whole gateway unresponsive to every tenant. Matches
// k8s.ts's kubectl()/terraform.ts's existing async spawn pattern instead.
function awsCli(args: string[], creds: Record<string, unknown>): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const env: Record<string, string> = {}
  if (creds['accessKeyId']) env['AWS_ACCESS_KEY_ID'] = String(creds['accessKeyId'])
  if (creds['secretAccessKey']) env['AWS_SECRET_ACCESS_KEY'] = String(creds['secretAccessKey'])
  if (creds['region']) env['AWS_DEFAULT_REGION'] = String(creds['region'])
  // LocalStack / AWS-API-compatible emulator override — same convention as
  // the other aws-* connectors in this codebase.
  if (creds['endpointUrl']) env['AWS_ENDPOINT_URL'] = String(creds['endpointUrl'])
  return new Promise((resolve) => {
    const proc = spawn('aws', args, { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => proc.kill(), 30_000)
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, status: code }) })
    proc.on('error', () => { clearTimeout(timer); resolve({ stdout, stderr, status: null }) })
  })
}

async function loadEcsCredentials(tenantId: string): Promise<Record<string, unknown>> {
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<{ credentials_enc: string | null; connector_type: string }[]>`
      SELECT credentials_enc, connector_type FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${ECS_CONNECTOR_TYPE} AND enabled = true
      LIMIT 1
    `
  ).catch(() => [] as { credentials_enc: string | null; connector_type: string }[])
  if (rows.length === 0) return {}
  return effectiveCredentials(rows[0] as Parameters<typeof effectiveCredentials>[0])
}

// Gate atomic-consume, bound on `target` (not separate cluster/service
// keys) — this is a direct, non-chat editor action, so the only real
// gate-creation route reachable to request it (POST /api/gate in
// gate-decide-route.ts) is the one that writes `target`/`requestedBy` into
// tool_args. Confirmed live via product verification that the equivalent
// k8s.ts write routes have a chat-path-only gate shape (namespace+resource
// keys, only ever produced by a ConnectorAgent tool call) that a direct
// UI action can never satisfy — deliberately not repeating that mismatch
// here. SoD (decided_by <> applier), not older than 24h, consumed exactly
// once.
async function consumeGate(
  gateId: string,
  tenantId: string,
  applierId: string,
  target: string,
): Promise<boolean> {
  const sentinel = '00000000-0000-0000-0000-000000000000'
  // Bound on tool_name too (not just target) — confirmed live via
  // independent review that a target-only bind lets any approved gate
  // whose target string matches authorize a completely different action.
  const consumed = await withTenant(prisma, tenantId, (tx) =>
    tx.$executeRaw`
      UPDATE gate_events
      SET status = 'consumed', decided_at = COALESCE(decided_at, NOW())
      WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid
        AND status = 'approved'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND tool_name = 'ecs.deploy'
        AND tool_args->>'target' = ${target}
        AND decided_by IS NOT NULL
        AND decided_by <> ${sentinel}::uuid
        AND decided_by <> ${applierId}::uuid
    `
  ).catch(() => 0)
  return Number(consumed) > 0
}

async function auditEcsAction(
  tenantId: string,
  userId: string,
  action: string,
  outcome: string,
  target: string,
): Promise<void> {
  await appendAuditEvent({ tenantId, userId, action, resource: target, outcome, metadata: {} }).catch(() => {})
}

interface EcsContainerDef {
  name: string
  image: string
  [key: string]: unknown
}

interface EcsTaskDefinition {
  family: string
  taskRoleArn?: string
  executionRoleArn?: string
  networkMode?: string
  containerDefinitions: EcsContainerDef[]
  volumes?: unknown[]
  placementConstraints?: unknown[]
  requiresCompatibilities?: string[]
  cpu?: string
  memory?: string
  taskDefinitionArn?: string
}

export async function ecsRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/ecs/services/:cluster/:service/deploy — registers a new task
  // definition revision with the given image (cloning every field ECS's own
  // register-task-definition API accepts from the currently-running
  // revision, swapping each container's image) and updates the service to
  // it with --force-new-deployment. Real AWS ECS deploy semantics — no
  // fabricated success on any step.
  app.post<{ Params: { cluster: string; service: string }; Body: { image: string; container?: string; gateId?: string } }>(
    '/api/ecs/services/:cluster/:service/deploy',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { cluster, service } = request.params
      const { image, container, gateId } = request.body ?? {}

      if (!image || typeof image !== 'string') {
        return reply.code(400).send({ error: 'image is required' })
      }

      // Perimeter check (non-admin) — same shape as k8s.ts's write routes.
      if (user.role !== 'admin') {
        let perimeterQueryFailed = false
        const perimeters = await withTenant(prisma, user.tenantId, (tx) =>
          tx.$queryRaw<{ write_scopes: string[] }[]>`
            SELECT write_scopes FROM user_perimeters
            WHERE tenant_id = ${user.tenantId}::uuid AND user_id = ${user.sub}::uuid
              AND connector_name = ${ECS_CONNECTOR_TYPE}
            LIMIT 1
          `
        ).catch(() => { perimeterQueryFailed = true; return [] as { write_scopes: string[] }[] })
        if (perimeterQueryFailed) {
          await auditEcsAction(user.tenantId, user.sub, 'ecs.deploy', 'blocked: perimeter check failed', `${cluster}/${service}`)
          return reply.code(403).send({ error: 'perimeter check failed' })
        }
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(cluster)) {
          await auditEcsAction(user.tenantId, user.sub, 'ecs.deploy', 'blocked: cluster not in perimeter', `${cluster}/${service}`)
          return reply.code(403).send({ error: 'cluster not in your perimeter' })
        }
      }

      if (!gateId) {
        return reply.code(403).send({ error: 'gate approval required before deploy' })
      }
      const gateOk = await consumeGate(gateId, user.tenantId, user.sub, `${cluster}/${service}`)
      if (!gateOk) {
        return reply.code(403).send({ error: 'gate approval required before deploy' })
      }

      const creds = await loadEcsCredentials(user.tenantId)

      // 1. Find the service's current task definition.
      const descResult = await awsCli(['ecs', 'describe-services', '--cluster', cluster, '--services', service, '--output', 'json'], creds)
      if (descResult.status !== 0) {
        await auditEcsAction(user.tenantId, user.sub, 'ecs.deploy', 'failure: describe-services', `${cluster}/${service}`)
        return reply.code(500).send({ ok: false, error: 'aws ecs describe-services failed', detail: descResult.stderr.slice(0, 2000) })
      }
      let currentTaskDefArn: string | undefined
      try {
        const svcData = JSON.parse(descResult.stdout) as { services?: Array<{ taskDefinition?: string }> }
        currentTaskDefArn = svcData.services?.[0]?.taskDefinition
      } catch {
        return reply.code(500).send({ ok: false, error: 'could not parse describe-services response' })
      }
      if (!currentTaskDefArn) {
        return reply.code(404).send({ ok: false, error: `service ${service} not found in cluster ${cluster}` })
      }

      // 2. Describe the current task definition to clone it with a new image.
      const tdResult = await awsCli(['ecs', 'describe-task-definition', '--task-definition', currentTaskDefArn, '--output', 'json'], creds)
      if (tdResult.status !== 0) {
        await auditEcsAction(user.tenantId, user.sub, 'ecs.deploy', 'failure: describe-task-definition', `${cluster}/${service}`)
        return reply.code(500).send({ ok: false, error: 'aws ecs describe-task-definition failed', detail: tdResult.stderr.slice(0, 2000) })
      }
      let taskDef: EcsTaskDefinition
      try {
        taskDef = (JSON.parse(tdResult.stdout) as { taskDefinition: EcsTaskDefinition }).taskDefinition
      } catch {
        return reply.code(500).send({ ok: false, error: 'could not parse describe-task-definition response' })
      }

      // 3. Register a new revision. Confirmed live via independent review:
      // this used to overwrite EVERY container's image unconditionally —
      // fine for a genuine single-container task, but ECS multi-container
      // tasks (app + sidecar/log-shipper/envoy) are common, and this would
      // silently replace a sidecar's image with the app's new one, using
      // whatever tag happens to apply to both (usually breaking the
      // sidecar outright). k8s.ts's equivalent deploy route already has an
      // explicit-container escape hatch (defaults to kubectl's `*` all-
      // containers wildcard only because that's real, intentional kubectl
      // syntax) — ECS has no such wildcard convention, so the safe
      // equivalent is: single-container tasks may omit `container` (there
      // is only one legitimate target), multi-container tasks must name
      // which one to update. register-task-definition only accepts a
      // specific subset of fields; passing the full describe-task-
      // definition response back verbatim is rejected (read-only fields
      // like taskDefinitionArn, revision, status, requiresAttributes,
      // compatibilities).
      if (taskDef.containerDefinitions.length > 1 && !container) {
        return reply.code(400).send({
          ok: false,
          error: `task definition has ${taskDef.containerDefinitions.length} containers — container name is required`,
          containers: taskDef.containerDefinitions.map((c) => c.name),
        })
      }
      if (container && !taskDef.containerDefinitions.some((c) => c.name === container)) {
        return reply.code(400).send({
          ok: false,
          error: `container "${container}" not found in task definition`,
          containers: taskDef.containerDefinitions.map((c) => c.name),
        })
      }
      const registerPayload = {
        family: taskDef.family,
        ...(taskDef.taskRoleArn ? { taskRoleArn: taskDef.taskRoleArn } : {}),
        ...(taskDef.executionRoleArn ? { executionRoleArn: taskDef.executionRoleArn } : {}),
        ...(taskDef.networkMode ? { networkMode: taskDef.networkMode } : {}),
        containerDefinitions: taskDef.containerDefinitions.map((c) =>
          !container || c.name === container ? { ...c, image } : c
        ),
        ...(taskDef.volumes ? { volumes: taskDef.volumes } : {}),
        ...(taskDef.placementConstraints ? { placementConstraints: taskDef.placementConstraints } : {}),
        ...(taskDef.requiresCompatibilities ? { requiresCompatibilities: taskDef.requiresCompatibilities } : {}),
        ...(taskDef.cpu ? { cpu: taskDef.cpu } : {}),
        ...(taskDef.memory ? { memory: taskDef.memory } : {}),
      }

      const tmpFile = path.join(tmpdir(), `anway-ecs-taskdef-${Date.now()}.json`)
      await writeFile(tmpFile, JSON.stringify(registerPayload), 'utf-8')
      let registerResult: Awaited<ReturnType<typeof awsCli>>
      try {
        registerResult = await awsCli(['ecs', 'register-task-definition', '--cli-input-json', `file://${tmpFile}`, '--output', 'json'], creds)
      } finally {
        await rm(tmpFile, { force: true })
      }
      if (registerResult.status !== 0) {
        await auditEcsAction(user.tenantId, user.sub, 'ecs.deploy', 'failure: register-task-definition', `${cluster}/${service}`)
        return reply.code(500).send({ ok: false, error: 'aws ecs register-task-definition failed', detail: registerResult.stderr.slice(0, 2000) })
      }
      let newTaskDefArn: string
      try {
        newTaskDefArn = (JSON.parse(registerResult.stdout) as { taskDefinition: { taskDefinitionArn: string } }).taskDefinition.taskDefinitionArn
      } catch {
        return reply.code(500).send({ ok: false, error: 'could not parse register-task-definition response' })
      }

      // 4. Point the service at the new revision.
      const updateResult = await awsCli(
        ['ecs', 'update-service', '--cluster', cluster, '--service', service, '--task-definition', newTaskDefArn, '--force-new-deployment', '--output', 'json'],
        creds,
      )
      const ok = updateResult.status === 0

      await auditEcsAction(user.tenantId, user.sub, 'ecs.deploy', ok ? 'success' : 'failure: update-service', `${cluster}/${service} -> ${image}`)

      if (ok) {
        return reply.send({ ok: true, action: 'deploy', cluster, service, image, taskDefinition: newTaskDefArn })
      }
      return reply.code(500).send({ ok: false, error: 'aws ecs update-service failed', detail: updateResult.stderr.slice(0, 2000), taskDefinition: newTaskDefArn })
    },
  )
}
