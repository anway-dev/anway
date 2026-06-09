import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_vulnerabilities', description: 'List vulnerabilities', parameters: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } }, execute: () => Promise.resolve({ vulns: [{ id:'v-1',severity:'high',title:'XSS vulnerability',packageName:'lodash',fixable:true }] }), write: false },
]

export class SnykAgent implements IConnectorAgent {
  readonly connectorType = 'snyk'
  readonly tools = TOOLS
}
