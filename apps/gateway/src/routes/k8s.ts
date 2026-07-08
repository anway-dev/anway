import type { FastifyInstance } from 'fastify'
import { spawn } from 'node:child_process'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'
import { effectiveCredentials } from '../utils/credentials.js'

const K8S_CONNECTOR_TYPES = ['k8s', 'eks', 'gke']

interface EntityRow {
  id: string
  name: string
  type: string
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// kubectl helper — same real kubectl invocation K8sAgent (connectors/k8s)
// uses, but async. Confirmed live via independent review: this used
// spawnSync with a 30s timeout — on a single-threaded Node gateway process,
// that blocks the ENTIRE event loop (every tenant's every in-flight
// request) for up to 30 real seconds per call, on every restart/scale/
// deploy/cordon. terraform.ts's equivalent CLI call already uses async
// spawn; this now matches that pattern instead of the older sync one.
// ---------------------------------------------------------------------------
function kubectl(args: string[], creds: Record<string, unknown>): Promise<{ stdout: string; status: number | null }> {
  const kubeconfig = typeof creds.kubeconfig === 'string' ? creds.kubeconfig : undefined
  const fullArgs = kubeconfig ? ['--kubeconfig', kubeconfig, ...args] : args
  return new Promise((resolve) => {
    const proc = spawn('kubectl', fullArgs)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => proc.kill(), 30_000)
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => { clearTimeout(timer); resolve({ stdout: stdout + stderr, status: code }) })
    proc.on('error', () => { clearTimeout(timer); resolve({ stdout: stderr, status: null }) })
  })
}

async function loadK8sCredentials(tenantId: string): Promise<Record<string, unknown>> {
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<{ credentials_enc: string | null; connector_type: string }[]>`
      SELECT credentials_enc, connector_type FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND connector_type = ANY(${K8S_CONNECTOR_TYPES}::text[])
        AND enabled = true
      LIMIT 1
    `
  ).catch(() => [] as { credentials_enc: string | null; connector_type: string }[])

  if (rows.length === 0) return {}
  return effectiveCredentials(rows[0] as Parameters<typeof effectiveCredentials>[0])
}

// ---------------------------------------------------------------------------
// Gate atomic-consume — copies terraform.ts:124-150 reference pattern
// ---------------------------------------------------------------------------
// Binding on namespace+resource alone (the original check) meant an
// approved gate for "restart deployment X in prod" — chat-created via
// ConnectorAgent, real tool_name k8s__restart_deployment per
// connector-tools-adapter.ts's `${connectorType}__${toolName}` naming —
// could ALSO be consumed to authorize *scaling* the same deployment (a
// completely different, differently-reviewed action), since nothing here
// ever checked tool_name. Confirmed live via TWO independent review passes
// (this session). Now binds on the real tool_name for each of the 3 call
// sites below, and — for scale specifically — the real `replicas` value
// that was actually approved, so "approved: scale to 2" can't be consumed
// as "scale to 0".
async function consumeGate(
  gateId: string,
  tenantId: string,
  applierId: string,
  toolName: string,
  namespace: string,
  resourceKey: 'deployment' | 'node',
  resourceName: string,
  replicas?: number,
): Promise<boolean> {
  const sentinel = '00000000-0000-0000-0000-000000000000'
  const noReplicasCheck = replicas === undefined
  const consumed = await withTenant(prisma, tenantId, (tx) =>
    tx.$executeRaw`
      UPDATE gate_events
      SET status = 'consumed', decided_at = COALESCE(decided_at, NOW())
      WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid
        AND status = 'approved'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND tool_name = ${toolName}
        AND (${namespace} = '' OR tool_args->>'namespace' = ${namespace})
        AND tool_args->>${resourceKey} = ${resourceName}
        AND (${noReplicasCheck} OR (tool_args->>'replicas')::int = ${replicas ?? 0})
        AND decided_by IS NOT NULL
        AND decided_by <> ${sentinel}::uuid
        AND decided_by <> ${applierId}::uuid
    `
  ).catch(() => 0)

  return Number(consumed) > 0
}

// Alternate consume check for the new /deploy route below (a direct,
// non-chat editor action — restart/scale/cordon above are only ever
// approvable via a chat-triggered ConnectorAgent gate, which naturally
// carries namespace+deployment in tool_args from the tool call's own real
// args; there is no equivalent chat step for a direct "click deploy in the
// editor" request). The only gate-creation route reachable outside chat
// (POST /api/gate in gate-decide-route.ts) writes `target`/`requestedBy`
// into tool_args, not `namespace`/`deployment` — so this checks that shape
// instead, binding on the same real `<namespace>/<name>` string this file's
// own auditK8sAction already uses for its `target` field.
async function consumeGateByTarget(
  gateId: string,
  tenantId: string,
  applierId: string,
  toolName: string,
  target: string,
): Promise<boolean> {
  const sentinel = '00000000-0000-0000-0000-000000000000'
  // Confirmed live via independent review: binding on `target` alone let
  // any approved gate whose target string happened to match authorize a
  // DIFFERENT action — e.g. a gate approved for "editor.commit" against a
  // path string that collided with a "prod/api" namespace/deployment
  // target could be replayed here. tool_name closes that.
  const consumed = await withTenant(prisma, tenantId, (tx) =>
    tx.$executeRaw`
      UPDATE gate_events
      SET status = 'consumed', decided_at = COALESCE(decided_at, NOW())
      WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid
        AND status = 'approved'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND tool_name = ${toolName}
        AND tool_args->>'target' = ${target}
        AND decided_by IS NOT NULL
        AND decided_by <> ${sentinel}::uuid
        AND decided_by <> ${applierId}::uuid
    `
  ).catch(() => 0)
  return Number(consumed) > 0
}

async function auditK8sAction(
  tenantId: string,
  userId: string,
  action: string,
  outcome: string,
  target: string,
): Promise<void> {
  try {
    await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw`
        INSERT INTO audit_events (id, tenant_id, user_id, session_id, event_type, payload, created_at)
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, gen_random_uuid(),
                'write_action_executed',
                ${JSON.stringify({ action, outcome, target })}::jsonb, NOW())
      `
    )
  } catch { /* audit best-effort */ }
}

export async function k8sRoutes(app: FastifyInstance) {
  app.get('/api/k8s/overview', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user as { tenantId: string; sub: string; role?: string }
    const { tenantId } = user

    // Resolve user's allowed namespaces from user_perimeters (read_scopes on k8s connectors)
    let allowedNs: string[] | null = null
    if (user.role !== 'admin') {
      let perimeterQueryFailed = false
      const perimeters = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ read_scopes: string[] }[]>`
          SELECT read_scopes FROM user_perimeters
          WHERE tenant_id = ${tenantId}::uuid AND user_id = ${user.sub}::uuid
            AND connector_name = ANY(ARRAY['k8s','eks','gke']::text[])
          LIMIT 1
        `
      ).catch(() => { perimeterQueryFailed = true; return [] as { read_scopes: string[] }[] })
      if (perimeterQueryFailed) {
        return { connected: false, namespaces: [], workloads: [], events: [], summary: null }
      }
      allowedNs = perimeters[0]?.read_scopes ?? []
    }

    const connectors = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_type: string; enabled: boolean }[]>`
        SELECT connector_type, enabled FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = ANY(${K8S_CONNECTOR_TYPES}::text[])
      `
    ).catch(() => [])

    const enabledConnectors = connectors.filter(c => c.enabled)
    if (enabledConnectors.length === 0) {
      return { connected: false, namespaces: [], workloads: [], events: [], summary: null }
    }
    // Non-admin with empty perimeter has no namespace access — hide connector count
    if (allowedNs !== null && allowedNs.length === 0 && !allowedNs.includes('*')) {
      return { connected: false, namespaces: [], workloads: [], events: [], summary: null }
    }

    // Load connector-level namespace filter (null = all namespaces)
    let connectorNsFilter: string[] | null = null
    try {
      const cfgRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ last_bootstrap_summary: Record<string, unknown> | null }[]>`
          SELECT last_bootstrap_summary FROM connector_config
          WHERE tenant_id = ${tenantId}::uuid AND connector_type = ANY(${K8S_CONNECTOR_TYPES}::text[])
            AND enabled = true LIMIT 1
        `
      )
      const summary = cfgRows[0]?.last_bootstrap_summary
      if (summary && Array.isArray(summary['namespace_filter'])) {
        connectorNsFilter = summary['namespace_filter'] as string[]
      }
    } catch { /* ignore — proceed without filter */ }

    const entities = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<EntityRow[]>`
        SELECT id, name, type, metadata FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type IN ('Service', 'Namespace', 'Alert')
        ORDER BY type, name LIMIT 500
      `
    ).catch(() => [])

    const namespaceEntities = entities.filter(e => e.type === 'Namespace')
    const serviceEntities = entities.filter(e => e.type === 'Service')
    const alertEntities = entities.filter(e => e.type === 'Alert')

    const nsAllowed = (name: string) => {
      if (connectorNsFilter !== null && connectorNsFilter.length > 0 && !connectorNsFilter.includes(name)) return false
      return allowedNs === null || allowedNs.includes('*') || allowedNs.includes(name)
    }

    const namespaces = namespaceEntities.map(ns => {
      const meta = (ns.metadata ?? {}) as Record<string, unknown>
      return {
        name: ns.name,
        pods: typeof meta.pods === 'number' ? meta.pods : 0,
        cpuUsed: typeof meta.cpuUsed === 'number' ? meta.cpuUsed : 0,
        cpuTotal: typeof meta.cpuTotal === 'number' ? meta.cpuTotal : 1,
        memUsed: typeof meta.memUsed === 'number' ? meta.memUsed : 0,
        memTotal: typeof meta.memTotal === 'number' ? meta.memTotal : 1,
        status: typeof meta.status === 'string' ? meta.status : 'Active',
      }
    }).filter(ns => nsAllowed(ns.name))

    const workloads = serviceEntities.flatMap(svc => {
      const meta = (svc.metadata ?? {}) as Record<string, unknown>
      const nsRaw = typeof meta.namespace === 'string' ? meta.namespace : null
      // For non-admin users, exclude workloads with absent namespace metadata (can't verify perimeter)
      if (nsRaw === null && allowedNs !== null) return []
      const namespace = nsRaw ?? 'default'
      if (!nsAllowed(namespace)) return []
      return [{
        name: svc.name,
        namespace,
        type: typeof meta.workloadType === 'string' ? meta.workloadType : 'Deployment',
        ready: typeof meta.readyReplicas === 'number' ? meta.readyReplicas : 0,
        desired: typeof meta.desiredReplicas === 'number' ? meta.desiredReplicas : 0,
        status: typeof meta.health === 'string' ? meta.health : 'Unknown',
      }]
    })

    const events = alertEntities.slice(0, 10).map(alert => {
      const meta = (alert.metadata ?? {}) as Record<string, unknown>
      return {
        severity: typeof meta.severity === 'string' && meta.severity === 'warning' ? 'warning' as const : 'normal' as const,
        reason: typeof meta.reason === 'string' ? meta.reason : 'Unknown',
        object: typeof meta.object === 'string' ? meta.object : alert.name,
        message: typeof meta.message === 'string' ? meta.message : alert.name,
        time: typeof meta.time === 'string' ? meta.time : 'recently',
      }
    })

    const runningPods = namespaces.reduce((sum, ns) => sum + ns.pods, 0)
    const failingWorkloads = workloads.filter(w => w.status === 'Degraded' || (w.desired > 0 && w.ready < w.desired)).length

    return {
      connected: true,
      summary: {
        nodes: enabledConnectors.length,
        namespaces: namespaces.length,
        runningPods,
        failingPods: failingWorkloads,
      },
      namespaces,
      workloads,
      events,
    }
  })

  // K8s write actions — all gated behind sre/admin role with atomic gate-consume pattern
  // POST /api/k8s/pods/:namespace/:name/restart
  app.post<{ Params: { namespace: string; name: string }; Body: { gateId?: string } }>(
    '/api/k8s/pods/:namespace/:name/restart',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { namespace, name } = request.params
      const { gateId } = request.body ?? {}

      // Perimeter check (non-admin)
      if (user.role !== 'admin') {
        let perimeterQueryFailed = false
        const perimeters = await withTenant(prisma, user.tenantId, (tx) =>
          tx.$queryRaw<{ write_scopes: string[] }[]>`
            SELECT write_scopes FROM user_perimeters
            WHERE tenant_id = ${user.tenantId}::uuid AND user_id = ${user.sub}::uuid
              AND connector_name = ANY(ARRAY['k8s','eks','gke']::text[])
            LIMIT 1
          `
        ).catch(() => { perimeterQueryFailed = true; return [] as { write_scopes: string[] }[] })
        if (perimeterQueryFailed) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.restart', 'blocked: perimeter check failed', `${namespace}/${name}`)
          return reply.code(403).send({ error: 'perimeter check failed' })
        }
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(namespace)) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.restart', 'blocked: namespace not in perimeter', `${namespace}/${name}`)
          return reply.code(403).send({ error: 'namespace not in your perimeter' })
        }
      }

      // Gate atomic-consume — must have an approved gateId, bound to this
      // exact deployment (see consumeGate above).
      if (!gateId) {
        return reply.code(403).send({ error: 'gate approval required before restart' })
      }
      const gateOk = await consumeGate(gateId, user.tenantId, user.sub, 'k8s__restart_deployment', namespace, 'deployment', name)
      if (!gateOk) {
        return reply.code(403).send({ error: 'gate approval required before restart' })
      }

      // Execute kubectl restart
      const creds = await loadK8sCredentials(user.tenantId)
      const result = await kubectl(['rollout', 'restart', 'deployment', name, '-n', namespace], creds)
      const ok = result.status === 0

      await auditK8sAction(user.tenantId, user.sub, 'k8s.restart', ok ? 'success' : 'failure', `${namespace}/${name}`)

      if (ok) {
        return reply.send({ ok: true, action: 'restart', deployment: name, namespace, output: result.stdout })
      }
      return reply.code(500).send({ ok: false, error: 'kubectl rollout restart failed', output: result.stdout })
    },
  )

  // POST /api/k8s/deployments/:namespace/:name/deploy — sets a new container
  // image on a real deployment (`kubectl set image`), the actual missing
  // piece for "edit code, build, deploy to k8s": restart/scale above only
  // ever operate on the deployment's EXISTING image. Confirmed live via
  // product verification that no route anywhere changes a deployment's
  // image at all. Same perimeter + atomic gate-consume + audit pattern as
  // restart/scale immediately above — this is a real external-effecting
  // write action, gated identically.
  app.post<{ Params: { namespace: string; name: string }; Body: { image: string; container?: string; gateId?: string } }>(
    '/api/k8s/deployments/:namespace/:name/deploy',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { namespace, name } = request.params
      const { image, container, gateId } = request.body ?? {}

      if (!image || typeof image !== 'string') {
        return reply.code(400).send({ error: 'image is required' })
      }

      // Perimeter check (non-admin)
      if (user.role !== 'admin') {
        let perimeterQueryFailed = false
        const perimeters = await withTenant(prisma, user.tenantId, (tx) =>
          tx.$queryRaw<{ write_scopes: string[] }[]>`
            SELECT write_scopes FROM user_perimeters
            WHERE tenant_id = ${user.tenantId}::uuid AND user_id = ${user.sub}::uuid
              AND connector_name = ANY(ARRAY['k8s','eks','gke']::text[])
            LIMIT 1
          `
        ).catch(() => { perimeterQueryFailed = true; return [] as { write_scopes: string[] }[] })
        if (perimeterQueryFailed) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.deploy', 'blocked: perimeter check failed', `${namespace}/${name}`)
          return reply.code(403).send({ error: 'perimeter check failed' })
        }
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(namespace)) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.deploy', 'blocked: namespace not in perimeter', `${namespace}/${name}`)
          return reply.code(403).send({ error: 'namespace not in your perimeter' })
        }
      }

      if (!gateId) {
        return reply.code(403).send({ error: 'gate approval required before deploy' })
      }
      const gateOk = await consumeGateByTarget(gateId, user.tenantId, user.sub, 'k8s.deploy', `${namespace}/${name}`)
      if (!gateOk) {
        return reply.code(403).send({ error: 'gate approval required before deploy' })
      }

      // `*=image` sets the image for every container in the pod spec — real
      // kubectl syntax, avoids requiring the caller to already know the
      // exact container name for the common single-container-per-pod case.
      const containerTarget = container?.trim() || '*'
      const creds = await loadK8sCredentials(user.tenantId)
      const result = await kubectl(['set', 'image', `deployment/${name}`, `${containerTarget}=${image}`, '-n', namespace], creds)
      const ok = result.status === 0

      await auditK8sAction(user.tenantId, user.sub, 'k8s.deploy', ok ? 'success' : 'failure', `${namespace}/${name} -> ${image}`)

      if (ok) {
        return reply.send({ ok: true, action: 'deploy', deployment: name, namespace, image, output: result.stdout })
      }
      return reply.code(500).send({ ok: false, error: 'kubectl set image failed', output: result.stdout })
    },
  )

  // POST /api/k8s/deployments/:namespace/:name/scale
  app.post<{ Params: { namespace: string; name: string }; Body: { replicas: number; gateId?: string } }>(
    '/api/k8s/deployments/:namespace/:name/scale',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { namespace, name } = request.params
      const { replicas, gateId } = request.body ?? {}

      if (typeof replicas !== 'number' || replicas < 0) {
        return reply.code(400).send({ error: 'replicas must be a non-negative number' })
      }

      // Perimeter check (non-admin)
      if (user.role !== 'admin') {
        let perimeterQueryFailed = false
        const perimeters = await withTenant(prisma, user.tenantId, (tx) =>
          tx.$queryRaw<{ write_scopes: string[] }[]>`
            SELECT write_scopes FROM user_perimeters
            WHERE tenant_id = ${user.tenantId}::uuid AND user_id = ${user.sub}::uuid
              AND connector_name = ANY(ARRAY['k8s','eks','gke']::text[])
            LIMIT 1
          `
        ).catch(() => { perimeterQueryFailed = true; return [] as { write_scopes: string[] }[] })
        if (perimeterQueryFailed) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.scale', 'blocked: perimeter check failed', `${namespace}/${name}`)
          return reply.code(403).send({ error: 'perimeter check failed' })
        }
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(namespace)) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.scale', 'blocked: namespace not in perimeter', `${namespace}/${name}`)
          return reply.code(403).send({ error: 'namespace not in your perimeter' })
        }
      }

      // Gate atomic-consume — bound to this exact deployment (see consumeGate above).
      if (!gateId) {
        return reply.code(403).send({ error: 'gate approval required before scale' })
      }
      const gateOk = await consumeGate(gateId, user.tenantId, user.sub, 'k8s__scale_deployment', namespace, 'deployment', name, replicas)
      if (!gateOk) {
        return reply.code(403).send({ error: 'gate approval required before scale' })
      }

      // Execute kubectl scale
      const creds = await loadK8sCredentials(user.tenantId)
      const result = await kubectl(['scale', '--replicas', String(replicas), `deployment/${name}`, '-n', namespace], creds)
      const ok = result.status === 0

      await auditK8sAction(user.tenantId, user.sub, 'k8s.scale', ok ? 'success' : 'failure', `${namespace}/${name}→${replicas}`)

      if (ok) {
        return reply.send({ ok: true, action: 'scale', deployment: name, namespace, replicas, output: result.stdout })
      }
      return reply.code(500).send({ ok: false, error: 'kubectl scale failed', output: result.stdout })
    },
  )

  // POST /api/k8s/nodes/:name/cordon
  app.post<{ Params: { name: string }; Body: { gateId?: string } }>(
    '/api/k8s/nodes/:name/cordon',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { name } = request.params
      const { gateId } = request.body ?? {}

      // Enforce write perimeter for non-admin users — node name treated as scope
      if (user.role !== 'admin') {
        let perimeterQueryFailed = false
        const perimeters = await withTenant(prisma, user.tenantId, (tx) =>
          tx.$queryRaw<{ write_scopes: string[] }[]>`
            SELECT write_scopes FROM user_perimeters
            WHERE tenant_id = ${user.tenantId}::uuid AND user_id = ${user.sub}::uuid
              AND connector_name = ANY(ARRAY['k8s','eks','gke']::text[])
            LIMIT 1
          `
        ).catch(() => { perimeterQueryFailed = true; return [] as { write_scopes: string[] }[] })
        if (perimeterQueryFailed) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.cordon', 'blocked: perimeter check failed', name)
          return reply.code(403).send({ error: 'perimeter check failed' })
        }
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(name)) {
          await auditK8sAction(user.tenantId, user.sub, 'k8s.cordon', 'blocked: node not in perimeter', name)
          return reply.code(403).send({ error: 'node not in your perimeter' })
        }
      }

      // Gate atomic-consume. Previously matched only tool_name IN
      // ('cordon_node', 'k8s.cordon') with no binding to which node — an
      // approved gate for cordoning node A could cordon node B, confirmed
      // live via independent review. Bind on the real node name too (see
      // consumeGate above — this route has no `namespace`, so pass an empty
      // string for that leg of the match and rely on the node-name bind).
      if (!gateId) {
        return reply.code(403).send({ error: 'gate approval required before cordon' })
      }
      const gateOk = await consumeGate(gateId, user.tenantId, user.sub, 'k8s__cordon_node', '', 'node', name)
      if (!gateOk) {
        return reply.code(403).send({ error: 'gate approval required before cordon' })
      }

      // Execute kubectl cordon
      const creds = await loadK8sCredentials(user.tenantId)
      const result = await kubectl(['cordon', name], creds)
      const ok = result.status === 0

      await auditK8sAction(user.tenantId, user.sub, 'k8s.cordon', ok ? 'success' : 'failure', name)

      if (ok) {
        return reply.send({ ok: true, action: 'cordon', node: name, output: result.stdout })
      }
      return reply.code(500).send({ ok: false, error: 'kubectl cordon failed', output: result.stdout })
    },
  )
}
