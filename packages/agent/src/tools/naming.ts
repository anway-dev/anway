/**
 * Extracts connector identifier from a tool name.
 * Tool naming convention: `<connector>.<action>` (e.g. `github.list_prs`).
 *
 * Returns `"github"` for `"github.list_prs"`, `"unknown"` for bare names.
 *
 * This is the single source of truth for connector-id-from-tool-name
 * extraction. Use in perimeter, gate, and audit.
 */
export function connectorIdFromTool(toolName: string): string {
  return toolName.split('.')[0] ?? toolName
}
