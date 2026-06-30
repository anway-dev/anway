import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_issues', description: 'List Sentry issues', parameters: { type: 'object', properties: { project: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['project'] } }, execute: () => Promise.resolve({ issues: [{ id:'s-1',title:'TypeError: undefined',count:42,firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_events', description: 'Get events for an issue', parameters: { type: 'object', properties: { issueId: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['issueId'] } }, execute: () => Promise.resolve({ events: [{ id:'e-1',message:'TypeError',stack:'at line 42',ts:new Date().toISOString() }] }), write: false },
]

export class SentryAgent implements IConnectorAgent {
  readonly connectorType = 'sentry'
  readonly tools = TOOLS
}
