import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'search_pages', description: 'Search pages', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }, execute: () => Promise.resolve({ pages: [{ id:'p-1',title:'Runbook',url:'https://...',updatedAt:new Date().toISOString() }] }), write: false },
]

export class ConfluenceAgent implements IConnectorAgent {
  readonly connectorType = 'confluence'
  readonly tools = TOOLS
}
