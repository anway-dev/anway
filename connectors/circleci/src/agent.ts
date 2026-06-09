import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } }, execute: () => Promise.resolve({ pipelines: [{ id:'pl-1',name:'Deploy',status:'passed',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } }, execute: () => Promise.resolve({ builds: [{ id:'b-1',sha:'abc123',status:'success',duration:120,startedAt:new Date().toISOString() }] }), write: false },
  { definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } }, execute: () => Promise.resolve({ runId: 'run-1' }), write: true },
]

export class CircleciAgent implements IConnectorAgent {
  readonly connectorType = 'circleci'
  readonly tools = TOOLS
}
