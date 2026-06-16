import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'

const K8S_CONNECTOR_TYPES = ['k8s', 'eks', 'gke']

interface EntityRow {
  id: string
  name: string
  type: string
  metadata: Record<string, unknown>
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

    const entities = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<EntityRow[]>`
        SELECT id, name, type, metadata FROM entities
        WHERE type IN ('Service', 'Namespace', 'Alert')
        ORDER BY type, name LIMIT 500
      `
    ).catch(() => [])

    const namespaceEntities = entities.filter(e => e.type === 'Namespace')
    const serviceEntities = entities.filter(e => e.type === 'Service')
    const alertEntities = entities.filter(e => e.type === 'Alert')

    const nsAllowed = (name: string) =>
      allowedNs === null || allowedNs.includes('*') || allowedNs.includes(name)

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

  // K8s write actions — all gated behind sre/admin role
  // POST /api/k8s/pods/:namespace/:name/restart
  app.post<{ Params: { namespace: string; name: string } }>(
    '/api/k8s/pods/:namespace/:name/restart',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { namespace, name } = request.params
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
        if (perimeterQueryFailed) return reply.code(403).send({ error: 'perimeter check failed' })
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(namespace)) {
          return reply.code(403).send({ error: 'namespace not in your perimeter' })
        }
      }
      return reply.code(501).send({ ok: false, status: 'not_implemented', message: 'K8s write actions require connector wiring' })
    },
  )

  // POST /api/k8s/deployments/:namespace/:name/scale
  app.post<{ Params: { namespace: string; name: string }; Body: { replicas: number } }>(
    '/api/k8s/deployments/:namespace/:name/scale',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { namespace, name } = request.params
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
        if (perimeterQueryFailed) return reply.code(403).send({ error: 'perimeter check failed' })
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(namespace)) {
          return reply.code(403).send({ error: 'namespace not in your perimeter' })
        }
      }
      const { replicas } = request.body
      if (typeof replicas !== 'number' || replicas < 0) {
        return reply.code(400).send({ error: 'replicas must be a non-negative number' })
      }
      return reply.code(501).send({ ok: false, status: 'not_implemented', message: 'K8s write actions require connector wiring' })
    },
  )

  // POST /api/k8s/nodes/:name/cordon
  app.post<{ Params: { name: string } }>(
    '/api/k8s/nodes/:name/cordon',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string; role?: string }
      const { name } = request.params
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
        if (perimeterQueryFailed) return reply.code(403).send({ error: 'perimeter check failed' })
        const allowed = perimeters[0]?.write_scopes ?? []
        if (!allowed.includes('*') && !allowed.includes(name)) {
          return reply.code(403).send({ error: 'node not in your perimeter' })
        }
      }
      return reply.code(501).send({ ok: false, status: 'not_implemented', message: 'K8s write actions require connector wiring' })
    },
  )
}
