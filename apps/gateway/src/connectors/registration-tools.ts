import type { ExecutableTool } from '@anway/agent'
import type { AgentRole } from '@anway/types'
import { registerConnectorTool, listConnectorsTool } from './registry.js'

/**
 * Two orchestrator tools for agent-driven connector registration.
 * Wired into the orchestrator's tool set for admin users.
 *
 * - register_connector: write action (gate approval required), admin role only
 * - list_connectors: read action, any authenticated user
 */
export function makeRegistrationTools(tenantId: string, role: AgentRole): ExecutableTool[] {
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
        if (role !== 'admin') {
          throw new Error('register_connector requires admin role')
        }
        const type = args['type'] as 'mcp' | 'cli'
        const name = args['name'] as string
        const config = args['config'] as Record<string, unknown>
        // Deterministic argument validation — found during first manual test:
        // the model called this with a graph-entity UUID as both name AND
        // cli binary and an empty subcommand list, and the gate dutifully
        // asked a human to approve garbage. A UUID is never a valid
        // connector name or binary; a cli connector with no allowed
        // subcommands can execute nothing. Reject before the gate fires so
        // the human is only ever asked to approve something coherent.
        const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (!name || UUID_LIKE.test(name)) {
          throw new Error(`register_connector: "${name}" is not a valid connector name — use a short tool name like "github" or "linear"`)
        }
        if (type === 'cli') {
          const binary = config?.['binary'] as string | undefined
          const subs = config?.['allowedSubcommands'] as unknown[] | undefined
          if (!binary || UUID_LIKE.test(binary) || !/^[a-zA-Z][a-zA-Z0-9._\/-]*$/.test(binary)) {
            throw new Error(`register_connector: "${binary}" is not a valid CLI binary name (e.g. "gh", "kubectl", "argocd")`)
          }
          if (!Array.isArray(subs) || subs.length === 0) {
            throw new Error('register_connector: cli connectors require a non-empty allowedSubcommands list — an empty list can execute nothing')
          }
        }
        if (type === 'mcp' && typeof config?.['url'] !== 'string') {
          throw new Error('register_connector: mcp connectors require config.url')
        }
        return registerConnectorTool(tenantId, type, name, config)
      },
    },
    {
      name: 'list_connectors',
      description: 'List all registered connectors with health status.',
      parameters: { type: 'object', properties: {} },
      async run() {
        return listConnectorsTool(tenantId)
      },
    },
  ]
}
