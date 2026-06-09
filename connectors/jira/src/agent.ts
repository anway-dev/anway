import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_issues', description: 'List issues', parameters: { type: 'object', properties: { project: { type: 'string' }, state: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }, required: ['project'] } }, execute: () => Promise.resolve({ issues: [{ id:'i-1',title:'Fix checkout bug',status:'open',assignee:'bob',priority:'high' }] }), write: false },
  { definition: { name: 'get_issue', description: 'Get issue details', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }, execute: () => Promise.resolve({ issue: { id:'i-1',title:'Fix checkout bug',description:'...',status:'open' } }), write: false },
  { definition: { name: 'create_issue', description: 'Create an issue', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string', optional: true }, labels: { type: 'array', items: { type: 'string' }, optional: true } }, required: ['title'] } }, execute: () => Promise.resolve({ id: 'i-new' }), write: true },
  { definition: { name: 'update_issue', description: 'Update issue status', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } }, required: ['id', 'status'] } }, execute: () => Promise.resolve({ ok: true }), write: true },
]

export class JiraAgent implements IConnectorAgent {
  readonly connectorType = 'jira'
  readonly tools = TOOLS
}
