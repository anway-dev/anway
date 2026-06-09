import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_secret_metadata', description: 'List secret keys at a path', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, execute: () => Promise.resolve({ keys: ['api-key','db-password'], lastUpdated: new Date().toISOString() }), write: false },
  { definition: { name: 'list_policies', description: 'List Vault policies', parameters: { type: 'object', properties: { } } }, execute: () => Promise.resolve({ policies: ['admin','readonly'] }), write: false },
]

export class VaultAgent implements IConnectorAgent {
  readonly connectorType = 'vault'
  readonly tools = TOOLS
}
