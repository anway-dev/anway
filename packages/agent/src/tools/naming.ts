/**
 * Extracts connector identifier from a tool name.
 * Supports both `<connector>.<action>` (legacy) and `<connector>__<action>` (LLM-API-safe).
 *
 * Returns `"github"` for `"github.list_prs"` and `"github__list_prs"`.
 *
 * This is the single source of truth for connector-id-from-tool-name
 * extraction. Use in perimeter, gate, and audit.
 */
export function connectorIdFromTool(toolName: string): string {
  if (toolName.includes('.')) return toolName.split('.')[0] ?? toolName
  if (toolName.includes('__')) return toolName.split('__')[0] ?? toolName
  return toolName
}
