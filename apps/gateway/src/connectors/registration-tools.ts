import type { ExecutableTool } from '@anvay/agent'
import { registerConnectorTool, listConnectorsTool } from './registry.js'

/**
 * Two orchestrator tools for agent-driven connector registration.
 * Wired into the orchestrator's tool set for admin users.
 *
 * - register_connector: write action (gate approval required), admin role only
 * - list_connectors: read action, any authenticated user
 */
export function makeRegistrationTools(tenantId: string): ExecutableTool[] {
  return [
    {
      name: 'register_connector',
      description: 'Register a new connector (MCP server or CLI binary). Admin only — requires gate approval.',
      parameters: {
        type: 'object',
        required: ['type', 'name', 'config'],
        properties: {
          type: { type: 'string', enum: ['mcp', 'cli'], description: 'Connector type' },
          name: { type: 'string', description: 'Connector name (e.g. "linear", "github")' },
          config: { type: 'object', description: 'Connector config. For MCP: { url: string }. For CLI: { binary: string, allowedSubcommands?: string[], env?: Record<string,string> }' },
        },
      },
      async run(args: Record<string, unknown>) {
        const type = args['type'] as 'mcp' | 'cli'
        const name = args['name'] as string
        const config = args['config'] as Record<string, unknown>
        return registerConnectorTool(tenantId, type, name, config)
      },
    },
    {
      name: 'list_connectors',
      description: 'List all registered connectors with health status.',
      parameters: {},
      async run() {
        return listConnectorsTool(tenantId)
      },
    },
  ]
}
