import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

interface EntityRow {
  id: string
  name: string
  type: string
  metadata: Record<string, unknown>
}

const CLOUD_CONNECTOR_TYPES = ['aws-cloudwatch', 'aws-health', 'gcp-monitoring', 'azure-monitor'] as const

const PROVIDER_META: Record<string, { label: string; icon: string; color: string }> = {
  aws:   { label: 'Amazon Web Services', icon: 'AWS', color: '#ff9900' },
  gcp:   { label: 'Google Cloud Platform', icon: 'GCP', color: '#4285f4' },
  azure: { label: 'Microsoft Azure', icon: 'AZ',  color: '#0078d4' },
}

function connectorToProvider(connectorType: string): string {
  if (connectorType.startsWith('aws')) return 'aws'
  if (connectorType.startsWith('gcp')) return 'gcp'
  if (connectorType.startsWith('azure')) return 'azure'
  return 'aws'
}

export async function cloudRoutes(app: FastifyInstance) {
  app.get('/api/cloud/resources', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }

    // Check which cloud connectors are enabled + bootstrapped
    const connectorRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ connector_type: string; enabled: boolean; bootstrapped_at: Date | null }>>`
        SELECT connector_type, enabled, bootstrapped_at
        FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid
          AND connector_type = ANY(${CLOUD_CONNECTOR_TYPES}::text[])
      `
    ).catch(() => [] as Array<{ connector_type: string; enabled: boolean; bootstrapped_at: Date | null }>)

    // Build provider connection map
    const connectedProviders = new Map<string, boolean>()
    for (const row of connectorRows) {
      const provider = connectorToProvider(row.connector_type)
      if (row.enabled && row.bootstrapped_at) {
        connectedProviders.set(provider, true)
      } else if (!connectedProviders.has(provider)) {
        connectedProviders.set(provider, false)
      }
    }

    // Query cloud entities from graph
    const entities = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<EntityRow[]>`
        SELECT id, name, type, metadata FROM entities
        WHERE type IN ('CloudResource', 'Alert')
          AND (metadata->>'source' = 'aws-cloudwatch'
            OR metadata->>'provider' IN ('aws', 'gcp', 'azure'))
        ORDER BY name LIMIT 500
      `
    ).catch(() => [] as EntityRow[])

    const resources: Array<{
      id: string; provider: string; name: string; type: string;
      service: string; region: string; status: string;
      metrics?: { cpu?: number; memory?: number; connections?: number; storage?: number }
    }> = []

    const security: Array<{
      id: string; provider: string; title: string; service: string;
      resource: string; severity: string; category: string; detail: string; detectedAt: string
    }> = []

    for (const e of entities) {
      const meta = e.metadata ?? {}
      const provider = (meta['provider'] as string) ?? 'aws'

      if (e.type === 'CloudResource') {
        resources.push({
          id: e.id,
          provider,
          name: e.name,
          type: (meta['resourceType'] as string) ?? 'Resource',
          service: (meta['service'] as string) ?? e.name,
          region: (meta['region'] as string) ?? 'us-east-1',
          status: (meta['status'] as string) ?? 'unknown',
          metrics: meta['metrics'] as { cpu?: number; memory?: number; connections?: number; storage?: number } | undefined,
        })
      } else if (e.type === 'Alert' && meta['source'] === 'aws-cloudwatch') {
        security.push({
          id: e.id,
          provider,
          title: e.name,
          service: (meta['namespace'] as string)?.split('/').pop() ?? 'AWS',
          resource: (meta['metric'] as string) ?? e.name,
          severity: (meta['severity'] as string) ?? 'high',
          category: 'misconfiguration',
          detail: (meta['description'] as string) ?? e.name,
          detectedAt: (meta['firedAt'] as string) ?? new Date().toISOString(),
        })
      }
    }

    // Build provider summary list
    const allProviders = ['aws', 'gcp', 'azure'].map(p => {
      const meta = PROVIDER_META[p] ?? { label: p, icon: p.toUpperCase(), color: '#888' }
      const connected = connectedProviders.get(p) ?? false
      const providerResources = resources.filter(r => r.provider === p)
      const regions = new Set(providerResources.map(r => r.region)).size
      const criticalAlerts = security.filter(s => s.provider === p && s.severity === 'critical').length
      const securityFindings = security.filter(s => s.provider === p).length
      return {
        provider: p,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        connected,
        resources: providerResources.length,
        regions: connected ? Math.max(regions, 1) : 0,
        criticalAlerts,
        securityFindings,
      }
    })

    // Populate config from cloud connector entity metadata (not hardcoded empty)
    const configFindings = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ name: string; metadata: Record<string, unknown> }>>`
        SELECT name, metadata FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type IN ('Finding', 'Config')
        ORDER BY name LIMIT 50
      `
    ).catch(() => [] as Array<{ name: string; metadata: Record<string, unknown> }>)
    const config = configFindings.map(c => ({
      service: (c.metadata?.service as string) ?? c.name,
      severity: (c.metadata?.severity as string) ?? 'medium',
      finding: typeof c.metadata?.finding === 'string' ? c.metadata.finding : c.name,
    }))

    return { providers: allProviders, resources, security, config }
  })
}
