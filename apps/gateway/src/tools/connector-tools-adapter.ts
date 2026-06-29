import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent } from '@anvay/agent'
import type { ExecutableTool } from '@anvay/agent'

/**
 * Adapts an IConnectorAgent's tools to ExecutableTool[] for the orchestrator.
 * Names tools: `${connectorType}__${toolName}` (e.g. k8s__get_pods).
 * V1: write=true tools filtered out — read-only agent operation.
 */
export function adaptConnectorAgent(
  agent: IConnectorAgent,
  creds: ConnectorCreds,
): ExecutableTool[] {
  return agent.tools
    .filter(t => !t.write)
    .map(t => ({
      name: `${agent.connectorType}__${t.definition.name}`,
      description: t.definition.description,
      parameters: t.definition.parameters as Record<string, unknown>,
      run: (args: Record<string, unknown>) => t.execute(args, creds),
    }))
}
