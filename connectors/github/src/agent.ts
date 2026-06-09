import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_prs', description: 'List pull requests', parameters: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }, required: ['repo'] } }, execute: () => Promise.resolve({ prs: [{ id:1,title:'Fix bug',state:'open',author:'alice',mergedAt:null,sha:'abc123' }] }), write: false },
  { definition: { name: 'get_commits', description: 'List commits', parameters: { type: 'object', properties: { repo: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['repo'] } }, execute: () => Promise.resolve({ commits: [{ sha:'abc123',message:'fix: bug',author:'alice',date:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_file', description: 'Get file content', parameters: { type: 'object', properties: { repo: { type: 'string' }, path: { type: 'string' }, ref: { type: 'string', optional: true } }, required: ['repo', 'path'] } }, execute: () => Promise.resolve({ content: '// file content' }), write: false },
  { definition: { name: 'create_pr', description: 'Create a pull request', parameters: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' } }, required: ['repo', 'title', 'base', 'head'] } }, execute: () => Promise.resolve({ url: 'https://github.com/org/repo/pull/1' }), write: true },
]

export class GithubAgent implements IConnectorAgent {
  readonly connectorType = 'github'
  readonly tools = TOOLS
}
