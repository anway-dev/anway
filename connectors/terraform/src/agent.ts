import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_workspaces', description: 'List workspaces', parameters: { type: 'object', properties: { } } }, execute: () => Promise.resolve({ workspaces: [{ name:'prod',status:'healthy',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_run', description: 'Get workspace run details', parameters: { type: 'object', properties: { workspaceId: { type: 'string' } }, required: ['workspaceId'] } }, execute: () => Promise.resolve({ run: { id:'r-1',status:'applied',message:'Deploy v2.3',appliedAt:new Date().toISOString() } }), write: false },
]

export class TerraformAgent implements IConnectorAgent {
  readonly connectorType = 'terraform'
  readonly tools = TOOLS
}
