import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph, IModelProvider } from '@anway/agent'
import { classifyToolRoles } from '@anway/agent'
import type { ToolRoleMap } from '@anway/agent'
import type { TenantId } from '@anway/types'
import { CliConnector } from './connector.js'

/**
 * Generic bootstrap for any CLI-backed connector instance. Same template
 * pattern as McpConnectorBootstrap (packages/mcp-adapter) — every registered
 * instance (a distinct real binary + allowedSubcommands/env, e.g. one
 * customer service's internal CLI vs another's) gets its own subcommand
 * discovery + role classification here, keyed by that instance's own
 * connectorId/payload, exactly like any native connector's bootstrap.
 */
export class CliConnectorBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly classifierModel?: IModelProvider,
  ) {}

  async bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const binary = payload['binary'] as string | undefined
    const name = (payload['name'] as string | undefined) ?? connectorId
    if (!binary) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`CLI connector "${name}": no binary configured — cannot discover subcommands`] }
    }

    const allowedSubcommands = payload['allowedSubcommands'] as string[] | undefined
    const env = payload['env'] as Record<string, string> | undefined
    const adapter = new CliConnector({ name, binary, allowedSubcommands, env })
    let tools: Awaited<ReturnType<CliConnector['getTools']>>
    try {
      tools = await adapter.getTools()
    } catch (err) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`CLI connector "${name}" (${binary}) discovery failed: ${err instanceof Error ? err.message : String(err)}`] }
    }

    let roleMap = payload['toolRoleMap'] as ToolRoleMap | undefined
    if (!roleMap && this.classifierModel && tools.length > 0) {
      roleMap = await classifyToolRoles(this.classifierModel, tools.map(t => ({ name: t.name, description: t.description })))
    }

    const episodeHints = [`CLI connector "${name}" (${binary}): ${tools.length} subcommands discovered (${tools.map(t => t.name).join(', ')})`]
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
                source: `cli:${name}`,
                connectorType: 'cli',
                connectorName: name,
                connectorId,
                connectorCoordinates: {
                  [name]: { connectorType: 'cli', resourceIds: { id: resourceId(item) }, resolvedAt: new Date().toISOString(), confidence: 0.7 },
                },
              },
            }, tenantId)
            entitiesUpserted++
          }
          episodeHints.push(`CLI connector "${name}": discovery subcommand "${roleMap.discovery}" returned ${items.length} resources`)
        } catch (err) {
          episodeHints.push(`CLI connector "${name}": discovery subcommand call failed — ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } else {
      episodeHints.push(`CLI connector "${name}": no discovery-role subcommand identified — 0 entities bootstrapped (honest, not fabricated)`)
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints,
      metadata: roleMap ? { toolRoleMap: roleMap } : undefined,
    }
  }
}

/** CLI tool results have no fixed schema — heuristically find "the list" in an arbitrary JSON shape. */
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
  return String(item['name'] ?? item['title'] ?? item['id'] ?? 'unknown resource')
}

function resourceId(item: Record<string, unknown>): string {
  return String(item['id'] ?? item['uid'] ?? item['name'] ?? '')
}
