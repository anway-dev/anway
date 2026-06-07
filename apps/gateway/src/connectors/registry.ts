import { PrismaClient } from '@prisma/client'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'
import type { ExecutableTool } from '@anvay/agent'

// Registry cache per tenant
const registryCache = new Map<string, IConnector[]>()

function clearCache(): void {
  registryCache.clear()
}

async function loadConnectors(prisma: PrismaClient, tenantId: string): Promise<IConnector[]> {
  const rows = await prisma.connector.findMany({ where: { tenant_id: tenantId } })
  return rows.map((row) => {
    const manifest = row.capability_manifest as CapabilityManifest | null
    return {
      id: row.id,
      capabilities: manifest ?? { read: ['*'], write: [] },
      async read(query: ConnectorQuery): Promise<ConnectorResult> {
        return {
          source: `connector:${row.type}:${row.id}`,
          fetched_at: new Date(),
          ttl: 120,
          freshness_score: 1.0,
          data: { message: `Connector ${row.type} read not implemented — returning mock`, query },
        }
      },
      async write(action: ConnectorAction): Promise<ConnectorResult> {
        return {
          source: `connector:${row.type}:${row.id}`,
          fetched_at: new Date(),
          ttl: 120,
          freshness_score: 1.0,
          data: { message: `Connector ${row.type} write not implemented — returning mock`, action },
        }
      },
      async health(): Promise<HealthStatus> {
        return { status: 'healthy', lastChecked: new Date() }
      },
    }
  })
}

export async function getConnectorsForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<IConnector[]> {
  if (!registryCache.has(tenantId)) {
    const connectors = await loadConnectors(prisma, tenantId)
    registryCache.set(tenantId, connectors)
  }
  return registryCache.get(tenantId)!
}

export async function getToolsForTenant(prisma: PrismaClient, tenantId: string): Promise<ExecutableTool[]> {
  const connectors = await getConnectorsForTenant(prisma, tenantId)
  return connectors.map((c) => {
    const prefix = c.id.replace(/[^a-zA-Z0-9_-]/g, '_')
    return {
      name: `${prefix}.read`,
      description: `Read from connector ${c.id}`,
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Query type to execute' },
        },
      },
      async run(args: Record<string, unknown>): Promise<unknown> {
        const result = await c.read(args as ConnectorQuery)
        return result.data
      },
    }
  })
}

export { clearCache }
