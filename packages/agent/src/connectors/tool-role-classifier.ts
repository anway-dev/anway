import type { IModelProvider } from '../interfaces/provider.js'
import { extractJson } from '../agents/extract-json.js'

/**
 * Standard lifecycle roles every native connector implements (bootstrap
 * discovery, search/query, single-item fetch). An MCP or CLI adapter is a
 * template, not a fixed connector — each registered instance points at a
 * different real MCP server or CLI binary with its own tool/subcommand
 * names, so there is no fixed name to call for "the discovery tool." This
 * maps whatever tools a given instance exposes onto those standard roles,
 * once per instance, so the orchestrator and the graph-builder bootstrap
 * can treat any MCP- or CLI-backed connector like a native one. Shared
 * between packages/mcp-adapter and packages/cli-adapter — the mapping
 * problem is identical for both (a named list of tool/subcommand + description).
 */
export interface ToolRoleMap {
  /** Tool/subcommand used to list/enumerate resources for initial graph bootstrap. */
  discovery?: string
  /** Tool/subcommand used for free-text search/query. */
  search?: string
  /** Tool/subcommand used to fetch a single resource by id. */
  get?: string
}

export interface ClassifiableTool {
  name: string
  description: string
}

/**
 * Classifies discovered tools/subcommands into standard lifecycle roles
 * using the cheap model tier (per CLAUDE.md's model-tier strategy — this is
 * a routing classification, not a reasoning task, so the expensive model is
 * never needed here). Best-effort: any role left unmapped just means that
 * lifecycle stage isn't available for this particular instance yet, not a
 * failure — e.g. a write-only MCP server has no discovery tool, and that's
 * a fact worth surfacing (episodeHints), not something to fabricate.
 */
export async function classifyToolRoles(
  cheapModel: IModelProvider,
  tools: ClassifiableTool[],
): Promise<ToolRoleMap> {
  if (tools.length === 0) return {}

  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n')
  const result = await cheapModel.chat([
    {
      role: 'system',
      content: 'You map a list of tools/subcommands exposed by an MCP server or CLI binary onto exactly three standard roles: "discovery" (lists/enumerates many resources, used for initial indexing), "search" (free-text search/query across resources), "get" (fetches one specific resource by id/key). Not every role needs a match — only map a role if a tool genuinely fits it. Respond ONLY with JSON matching { "discovery": string|null, "search": string|null, "get": string|null }, where each value is the exact tool/subcommand name or null.',
    },
    { role: 'user', content: `Tools:\n${toolList}` },
  ], [], { model: cheapModel.cheapModelId, maxTokens: 200, temperature: 0 })

  try {
    const parsed = extractJson<{ discovery: string | null; search: string | null; get: string | null }>(result.content)
    const map: ToolRoleMap = {}
    if (parsed.discovery && tools.some(t => t.name === parsed.discovery)) map.discovery = parsed.discovery
    if (parsed.search && tools.some(t => t.name === parsed.search)) map.search = parsed.search
    if (parsed.get && tools.some(t => t.name === parsed.get)) map.get = parsed.get
    return map
  } catch {
    return {}
  }
}
