import type { IModelProvider } from '../interfaces/provider.js'
import { extractJson } from '../agents/extract-json.js'

/**
 * Standard lifecycle roles every native connector implements (bootstrap
 * discovery, search/query, single-item fetch, write actions). An MCP or CLI
 * adapter is a template, not a fixed connector — each registered instance
 * points at a different real MCP server or CLI binary with its own
 * tool/subcommand names, so there is no fixed name to call for "the
 * discovery tool." This maps whatever tools a given instance exposes onto
 * those standard roles, once per instance, so the orchestrator and the
 * graph-builder bootstrap can treat any MCP- or CLI-backed connector like a
 * native one. Shared between packages/mcp-adapter and packages/cli-adapter —
 * the mapping problem is identical for both (a named list of
 * tool/subcommand + description).
 */
export interface ToolRoleMap {
  /** Tool/subcommand used to list/enumerate resources for initial graph bootstrap. */
  discovery?: string
  /** Tool/subcommand used for free-text search/query. */
  search?: string
  /** Tool/subcommand used to fetch a single resource by id. */
  get?: string
  /**
   * Tools/subcommands that mutate state (create/update/delete/trigger — any
   * side-effecting action). Unlike native connectors, an MCP/CLI instance's
   * tool set is discovered, not code-reviewed, so there's no per-tool
   * `write: boolean` flag baked in anywhere. Anything classified here still
   * gets exposed with write:true (never write:false) so it's excluded from
   * V1 chat exposure the same way every native connector's write tools are
   * (adaptConnectorAgent filters write:true tools out entirely — see
   * CLAUDE.md's V1 native-connector write posture note). Multiple tools can
   * be write actions, unlike the single-tool discovery/search/get roles.
   */
  write?: string[]
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
      content: 'You classify a list of tools/subcommands exposed by an MCP server or CLI binary. First, identify which ones mutate state in any way (create, update, delete, trigger, toggle, run/execute a side-effecting action, send/publish) — list ALL of those exact names as "write". Every tool not in "write" is read-only; among those, map at most one each onto "discovery" (lists/enumerates many resources, used for initial indexing), "search" (free-text search/query across resources), "get" (fetches one specific resource by id/key) — only map a role if a tool genuinely fits it, leave null if none do. Respond ONLY with JSON matching { "discovery": string|null, "search": string|null, "get": string|null, "write": string[] }.',
    },
    { role: 'user', content: `Tools:\n${toolList}` },
  ], [], { model: cheapModel.cheapModelId, maxTokens: 300, temperature: 0 })

  try {
    const parsed = extractJson<{ discovery: string | null; search: string | null; get: string | null; write?: string[] }>(result.content)
    const validNames = new Set(tools.map(t => t.name))
    const map: ToolRoleMap = {}
    if (parsed.discovery && validNames.has(parsed.discovery)) map.discovery = parsed.discovery
    if (parsed.search && validNames.has(parsed.search)) map.search = parsed.search
    if (parsed.get && validNames.has(parsed.get)) map.get = parsed.get
    if (Array.isArray(parsed.write)) {
      const write = parsed.write.filter((w): w is string => typeof w === 'string' && validNames.has(w))
      if (write.length > 0) map.write = write
    }
    return map
  } catch {
    return {}
  }
}
