import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'
import { PostgresAuditSink } from '../audit/postgres-sink.js'
import { TenantId, UserId, SessionId } from '@anvay/types'

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

    // Resolve user's allowed namespaces from user_perimeters
    let allowedNs: string[] | null = null
    if (user.role !== 'admin') {
      const perimeters = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ allowed_namespaces: string[] | null }[]>`
          SELECT allowed_namespaces FROM user_perimeters WHERE user_id = ${user.sub}::uuid LIMIT 1
        `
      ).catch(() => [])
      allowedNs = perimeters[0]?.allowed_namespaces ?? null
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
    }).filter(ns => allowedNs === null || allowedNs.includes(ns.name))

    const workloads = serviceEntities.map(svc => {
      const meta = (svc.metadata ?? {}) as Record<string, unknown>
      return {
        name: svc.name,
        namespace: typeof meta.namespace === 'string' ? meta.namespace : 'default',
        type: typeof meta.workloadType === 'string' ? meta.workloadType : 'Deployment',
        ready: typeof meta.readyReplicas === 'number' ? meta.readyReplicas : 0,
        desired: typeof meta.desiredReplicas === 'number' ? meta.desiredReplicas : 0,
        status: typeof meta.health === 'string' ? meta.health : 'Unknown',
      }
    }).filter(w => allowedNs === null || allowedNs.includes(w.namespace))

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
      const user = request.user as { tenantId: string; sub: string }
      const { namespace, name } = request.params
      const audit = new PostgresAuditSink(prisma, () => {})
      void audit.append({
        id: crypto.randomUUID(),
        tenantId: TenantId(user.tenantId),
        userId: UserId(user.sub),
        sessionId: SessionId(''),
        eventType: 'tool_call_allowed' as const,
        payload: { action: 'k8s.pod.restart', namespace, pod: name },
        createdAt: new Date(),
      })
      return reply.send({ ok: true, action: 'pod.restart', namespace, pod: name })
    },
  )

  // POST /api/k8s/deployments/:namespace/:name/scale
  app.post<{ Params: { namespace: string; name: string }; Body: { replicas: number } }>(
    '/api/k8s/deployments/:namespace/:name/scale',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string }
      const { namespace, name } = request.params
      const { replicas } = request.body
      if (typeof replicas !== 'number' || replicas < 0) {
        return reply.code(400).send({ error: 'replicas must be a non-negative number' })
      }
      const audit = new PostgresAuditSink(prisma, () => {})
      void audit.append({
        id: crypto.randomUUID(),
        tenantId: TenantId(user.tenantId),
        userId: UserId(user.sub),
        sessionId: SessionId(''),
        eventType: 'connector_write' as any,
        payload: { namespace, deployment: name, replicas },
        createdAt: new Date(),
      })
      return reply.send({ ok: true, action: 'deployment.scale', namespace, deployment: name, replicas })
    },
  )

  // POST /api/k8s/nodes/:name/cordon
  app.post<{ Params: { name: string } }>(
    '/api/k8s/nodes/:name/cordon',
    { preHandler: [app.authenticate, requireRole('sre', 'admin')] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; sub: string }
      const { name } = request.params
      const audit = new PostgresAuditSink(prisma, () => {})
      void audit.append({
        id: crypto.randomUUID(),
        tenantId: TenantId(user.tenantId),
        userId: UserId(user.sub),
        sessionId: SessionId(''),
        eventType: 'connector_write' as any,
        payload: { node: name },
        createdAt: new Date(),
      })
      return reply.send({ ok: true, action: 'node.cordon', node: name })
    },
  )
}
