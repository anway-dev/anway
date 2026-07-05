/**
 * MCP/CLI tool results have no fixed schema — these heuristics find "the
 * list of resources" in an arbitrary JSON shape, for turning a discovery
 * tool's output into real graph entities. Shared by whichever layer
 * bootstraps mcp/cli connectors into the graph.
 */

// MCP tool results are commonly a mixed content-block array — a leading
// {type: "text", text: "Here are N resources:"} preamble block alongside
// the real {type: "resource_link", name, uri, ...} entries. Confirmed live:
// without this filter, the preamble block itself became a real graph
// entity named "unknown resource" (it has no name/title/uri/id at all —
// it's prose, not a resource).
function looksLikeResource(d: Record<string, unknown>): boolean {
  if (d['type'] === 'text') return false
  return Boolean(d['name'] ?? d['title'] ?? d['uri'] ?? d['id'] ?? d['uid'])
}

/** Heuristically find "the list" in an arbitrary JSON shape. */
export function extractListItems(data: unknown): Array<Record<string, unknown>> {
  const isObj = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null
  if (Array.isArray(data)) return data.filter(isObj).filter(looksLikeResource)
  if (data && typeof data === 'object') {
    // Prefer the first NON-EMPTY array-valued property over the first array
    // found — an empty `errors: []` before a populated `items: [...]` would
    // otherwise short-circuit to nothing.
    let firstArray: unknown[] | null = null
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue
      if (firstArray === null) firstArray = v
      const filtered = v.filter(isObj).filter(looksLikeResource)
      if (filtered.length > 0) return filtered
    }
    if (firstArray) return firstArray.filter(isObj).filter(looksLikeResource)
  }
  return []
}

export function resourceName(item: Record<string, unknown>): string {
  return String(item['name'] ?? item['title'] ?? item['uri'] ?? item['id'] ?? 'unknown resource')
}

export function resourceId(item: Record<string, unknown>): string {
  return String(item['id'] ?? item['uid'] ?? item['uri'] ?? item['name'] ?? '')
}
