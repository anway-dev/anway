import { withTenant } from '../db/prisma.js'
import type { ExecutableTool } from '@anvay/agent'
import { McpConnector } from '@anvay/mcp-adapter'
import type { CliExecEntry } from '@anvay/cli-adapter'
import { CliConnector } from '@anvay/cli-adapter'
import type { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client.js'

type ConnectorRow = {
  id: string
  type: string
  name: string
  mode: string
  config_encrypted: Prisma.JsonValue
}

// Singleton cache per (tenantId, connectorId)
const adapterCache = new Map<string, McpConnector | CliConnector>()

function cacheKey(tenantId: string, connectorId: string): string {
  return `${tenantId}:${connectorId}`
}

function getCfg(row: ConnectorRow): Record<string, unknown> {
  if (typeof row.config_encrypted === 'object' && row.config_encrypted !== null && !Array.isArray(row.config_encrypted)) {
    return row.config_encrypted as Record<string, unknown>
  }
  return {}
}

function instantiateAdapter(row: ConnectorRow): McpConnector | CliConnector {
  const cfg = getCfg(row)
  const name = row.name || row.type

  if (row.type === 'mcp') {
    return new McpConnector({
      url: cfg['url'] as string ?? '',
      name,
    })
  }

  // CLI type — use allowedSubcommands if provided, else auto-discovery
  return new CliConnector({
    name,
    binary: row.type,
    allowedSubcommands: cfg['allowedSubcommands'] as string[] | undefined,
    env: cfg['env'] as Record<string, string> | undefined,
    onExec: (_entry: CliExecEntry) => {
      /* Audit via caller — registry doesn't have tenant context */
    },
  })
}

export async function getToolsForTenant(
  prismaClient: PrismaClient,
  tenantId: string,
): Promise<ExecutableTool[]> {
  const rows = await withTenant(prismaClient, tenantId, (tx) =>
    tx.connector.findMany({ where: { tenant_id: tenantId } })
  ) as unknown as ConnectorRow[]

  const tools: ExecutableTool[] = []

  for (const row of rows) {
    const key = cacheKey(tenantId, row.id)
    let adapter = adapterCache.get(key)

    if (!adapter) {
      adapter = instantiateAdapter(row)
      adapterCache.set(key, adapter)
    }

    const adapterTools = await adapter.getTools()
    tools.push(...adapterTools)
  }

  return tools
}

/** Registration tool: register_connector — write action, admin role only */
export async function registerConnectorTool(
  tenantId: string,
  type: 'mcp' | 'cli',
  name: string,
  config: Record<string, unknown>,
): Promise<{ connectorId: string; toolCount: number; tools: string[] }> {
  const row = await withTenant(prisma, tenantId, (tx) =>
    tx.connector.create({
      data: {
        tenant_id: tenantId,
        name,
        type,
        mode: 'read',
        config_encrypted: config as Prisma.JsonObject,
        capability_manifest: { capabilities: { read: ['*'], write: [] } } as Prisma.JsonObject,
      },
    })
  )

  // Instantiate and register in cache
  const adapter = instantiateAdapter({ id: row.id, type, name, mode: 'read', config_encrypted: config as Prisma.JsonObject })
  const key = cacheKey(tenantId, row.id)
  adapterCache.set(key, adapter)

  const tools = await adapter.getTools()
  const toolNames = tools.map((t) => t.name)

  return { connectorId: row.id, toolCount: tools.length, tools: toolNames }
}

/** List connectors tool: returns connector list for tenant */
export async function listConnectorsTool(tenantId: string): Promise<{ connectors: unknown[] }> {
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.connector.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, name: true, type: true, mode: true, created_at: true },
    })
  )
  return { connectors: rows }
}
