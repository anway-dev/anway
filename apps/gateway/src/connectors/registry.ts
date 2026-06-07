import { withTenant } from '../db/prisma.js'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'
import type { ExecutableTool } from '@anvay/agent'
import { GitHubConnector, makeGitHubTools } from '@anvay/connector-github'
import { LinearConnector, makeLinearTools } from '@anvay/connector-linear'
import { ArgoCDConnector, makeArgoCDTools } from '@anvay/connector-argocd'
import { DatadogConnector, makeDatadogTools } from '@anvay/connector-datadog'
import type { PrismaClient } from '@prisma/client'

type ConnectorRow = {
  id: string
  type: string
  mode: string
  capability_manifest: unknown
}

function createMockConnector(row: ConnectorRow, capabilities: CapabilityManifest): IConnector {
  return {
    id: row.id,
    capabilities,
    async read(_query: ConnectorQuery): Promise<ConnectorResult> {
      return { source: `connector:${row.type}:${row.id}`, fetched_at: new Date(), ttl: 120, freshness_score: 1.0, data: { message: `mock ${row.type} response` } }
    },
    async write(_action: ConnectorAction): Promise<ConnectorResult> {
      return { source: `connector:${row.type}:${row.id}`, fetched_at: new Date(), ttl: 120, freshness_score: 1.0, data: { message: `mock ${row.type} write` } }
    },
    async health(): Promise<HealthStatus> {
      return { status: 'healthy', lastChecked: new Date() }
    },
  }
}

function createConnectorWithTools(row: ConnectorRow): { connector: IConnector; tools: ExecutableTool[] } {
  const raw = row.capability_manifest as { capabilities?: { read?: string[]; write?: string[] } } | null
  const capabilities: CapabilityManifest = {
    read: raw?.capabilities?.read ?? ['*'],
    write: raw?.capabilities?.write ?? [],
  }

  switch (row.type) {
    case 'github': {
      const c = new GitHubConnector(row.id)
      return { connector: c, tools: makeGitHubTools(c) }
    }
    case 'linear': {
      const c = new LinearConnector(row.id)
      return { connector: c, tools: makeLinearTools(c) }
    }
    case 'argocd': {
      const c = new ArgoCDConnector(row.id)
      return { connector: c, tools: makeArgoCDTools(c) }
    }
    case 'datadog': {
      const c = new DatadogConnector(row.id, process.env['DATADOG_API_KEY'] ?? '', process.env['DATADOG_APP_KEY'] ?? '')
      return { connector: c, tools: makeDatadogTools(c) }
    }
    default:
      return { connector: createMockConnector(row, capabilities), tools: [] }
  }
}

export async function getToolsForTenant(prisma: PrismaClient, tenantId: string): Promise<ExecutableTool[]> {
  const connectors = await withTenant(prisma, tenantId, (tx) =>
    tx.connector.findMany({ where: { tenant_id: tenantId } })
  )
  return (connectors as unknown as ConnectorRow[]).flatMap(row => createConnectorWithTools(row).tools)
}
