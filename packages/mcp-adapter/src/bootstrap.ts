import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph, IModelProvider } from '@anway/agent'
import { classifyToolRoles } from '@anway/agent'
import type { ToolRoleMap } from '@anway/agent'
import type { TenantId } from '@anway/types'
import { McpConnector } from './connector.js'

/**
 * Generic bootstrap for any MCP-backed connector instance. Not a single
 * fixed connector — every registered instance (a distinct real MCP server
 * URL, e.g. one customer service's MCP endpoint vs another's) gets its own
 * tool discovery + role classification here, keyed by that instance's own
 * connectorId/payload, exactly like any native connector's bootstrap.
 */
export class McpConnectorBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly classifierModel?: IModelProvider,
  ) {}

  async bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const url = (payload['mcpUrl'] as string | undefined) ?? (payload['url'] as string | undefined)
    const name = (payload['name'] as string | undefined) ?? connectorId
    if (!url) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`MCP connector "${name}": no mcpUrl configured — cannot discover tools`] }
    }

    const adapter = new McpConnector({ url, name })
    let tools: Awaited<ReturnType<McpConnector['getTools']>>
    try {
      tools = await adapter.getTools()
    } catch (err) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`MCP connector "${name}" unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`] }
    }

    // An explicit toolRoleMap in payload (set at registration time, e.g. by
    // an admin who already knows their server's tools) always wins over
    // reclassifying — avoids paying a model call on every rediscovery once
    // a mapping is known good.
    let roleMap = payload['toolRoleMap'] as ToolRoleMap | undefined
    if (!roleMap && this.classifierModel && tools.length > 0) {
      roleMap = await classifyToolRoles(this.classifierModel, tools.map(t => ({ name: t.name, description: t.description })))
    }

    const episodeHints = [`MCP connector "${name}": ${tools.length} tools discovered (${tools.map(t => t.name).join(', ')})`]
    let entitiesUpserted = 0

    if (roleMap?.discovery) {
      const discoveryTool = tools.find(t => t.name === roleMap!.discovery)
      if (discoveryTool) {
        try {
          const result = await discoveryTool.run({}) as { data?: unknown }
          const items = extractListItems(result?.data ?? result)
          for (const item of items) {
            await this.kg.upsertEntity({
              type: 'Resource',
              name: resourceName(item),
              metadata: {
                source: `mcp:${name}`,
                // Explicit, top-level fields — not just embedded in the
                // `source` string or nested under connectorCoordinates — so
                // any consumer can immediately identify which specific MCP
                // connector INSTANCE produced this node without parsing
                // anything. Matters precisely because this bootstrap is a
                // shared template across many differently-configured
                // instances (see class doc comment).
                connectorType: 'mcp',
                connectorName: name,
                connectorId,
                connectorCoordinates: {
                  [name]: { connectorType: 'mcp', resourceIds: { id: resourceId(item) }, resolvedAt: new Date().toISOString(), confidence: 0.7 },
                },
              },
            }, tenantId)
            entitiesUpserted++
          }
          episodeHints.push(`MCP connector "${name}": discovery tool "${roleMap.discovery}" returned ${items.length} resources`)
        } catch (err) {
          episodeHints.push(`MCP connector "${name}": discovery tool call failed — ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } else {
      episodeHints.push(`MCP connector "${name}": no discovery-role tool identified — 0 entities bootstrapped (honest, not fabricated)`)
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints,
      metadata: roleMap ? { toolRoleMap: roleMap } : undefined,
    }
  }
}

/** MCP tool results have no fixed schema — heuristically find "the list" in an arbitrary JSON shape. */
function extractListItems(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
  if (data && typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(v)) return v.filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    }
  }
  return []
}

function resourceName(item: Record<string, unknown>): string {
  return String(item['name'] ?? item['title'] ?? item['uri'] ?? item['id'] ?? 'unknown resource')
}

function resourceId(item: Record<string, unknown>): string {
  return String(item['id'] ?? item['uid'] ?? item['uri'] ?? item['name'] ?? '')
}
