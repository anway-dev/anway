import { withTenant } from '../db/prisma.js'
import type { ExecutableTool } from '@anvay/agent'
import { McpConnector } from '@anvay/mcp-adapter'
import type { CliExecEntry } from '@anvay/cli-adapter'
import { CliConnector } from '@anvay/cli-adapter'
import { encryptJson, decryptJson } from '../utils/crypto.js'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '../db/client.js'
import { checkRateLimit } from './rate-limiter.js'

type ConnectorRow = {
  id: string
  type: string
  name: string
  mode: string
  config_enc?: string | null
}

// Singleton cache per (tenantId, connectorId) — bounded to prevent memory leak
const adapterCache = new Map<string, McpConnector | CliConnector>()
const MAX_ADAPTER_CACHE = 200
function cacheSetAdapter(key: string, val: McpConnector | CliConnector): void {
  if (adapterCache.size >= MAX_ADAPTER_CACHE) { const k = adapterCache.keys().next().value; if (k !== undefined) adapterCache.delete(k) }
  adapterCache.set(key, val)
}

function cacheKey(tenantId: string, connectorId: string): string {
  return `${tenantId}:${connectorId}`
}

function getCfg(row: ConnectorRow): Record<string, unknown> {
  if (row.config_enc) {
    try { return decryptJson<Record<string, unknown>>(row.config_enc) } catch { return {} }
  }
  return {}
}

function instantiateAdapter(row: ConnectorRow, tenantId: string): McpConnector | CliConnector {
  const cfg = getCfg(row)
  const name = row.name || row.type

  if (row.type === 'mcp') {
    return new McpConnector({
      url: cfg['url'] as string ?? '',
      name,
    })
  }

  // CLI type — binary from config, not from row.type
  return new CliConnector({
    name,
    binary: cfg['binary'] as string,
    allowedSubcommands: cfg['allowedSubcommands'] as string[] | undefined,
    env: cfg['env'] as Record<string, string> | undefined,
    onExec(entry: CliExecEntry) {
      void (async () => {
        try {
          await withTenant(prisma, tenantId, (tx) =>
            tx.auditEvent.create({
              data: {
                id: crypto.randomUUID(),
                tenant_id: tenantId,
                user_id: null,
                session_id: null,
                event_type: 'tool_call_allowed',
                payload: JSON.parse(JSON.stringify(entry)),
                created_at: new Date(),
              },
            })
          )
        } catch { /* swallow */ }
      })()
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

  // Load rate_limit_rps for each connector
  const rateLimits = await withTenant(prismaClient, tenantId, (tx) =>
    tx.$queryRaw<Array<{ connector_type: string; rate_limit_rps: number }>>`
      SELECT connector_type, COALESCE(rate_limit_rps, 10) AS rate_limit_rps
      FROM connector_config WHERE tenant_id = ${tenantId}::uuid
    `
  ).catch(() => [] as Array<{ connector_type: string; rate_limit_rps: number }>)
  const rpsByType = new Map(rateLimits.map(r => [r.connector_type, r.rate_limit_rps]))
  const DEFAULT_RPS = 10

  const adapterEntries = rows.map(async (row) => {
    const key = cacheKey(tenantId, row.id)
    let adapter = adapterCache.get(key)
    if (!adapter) {
      adapter = instantiateAdapter(row, tenantId)
      cacheSetAdapter(key, adapter)
    }
    const tools = await adapter.getTools()
    const connectorType = row.type
    const rps = rpsByType.get(connectorType) ?? DEFAULT_RPS
    // Wrap each tool with rate limiting
    return tools.map(t => ({
      ...t,
      run: async (args: Record<string, unknown>) => {
        const allowed = await checkRateLimit(tenantId, connectorType, rps)
        if (!allowed) {
          // Wait 1s and retry once
          await new Promise(r => setTimeout(r, 1000))
          const retry = await checkRateLimit(tenantId, connectorType, rps)
          if (!retry) return { error: 'rate limit exceeded' }
        }
        return t.run(args)
      },
    }))
  })
  const toolArrays = await Promise.all(adapterEntries)
  return toolArrays.flat()
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
        config_enc: encryptJson(config),
        capability_manifest: { capabilities: { read: ['*'], write: [] } },
      },
    })
  )

  const adapter = instantiateAdapter({ id: row.id, type, name, mode: 'read', config_enc: encryptJson(config) }, tenantId)
  const key = cacheKey(tenantId, row.id)
  cacheSetAdapter(key, adapter)

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
