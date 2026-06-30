import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } }, execute: () => Promise.resolve({ pipelines: [{ id:'pl-1',name:'Deploy',status:'passed',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } }, execute: () => Promise.resolve({ builds: [{ id:'b-1',sha:'abc123',status:'success',duration:120,startedAt:new Date().toISOString() }] }), write: false },
  {
    definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('CircleCI API key not configured')
      const res = await fetch(`https://circleci.com/api/v2/project/${String(params.service)}/pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Circle-Token': apiKey,
        },
        body: JSON.stringify({ branch: String(params.env), parameters: { sha: String(params.sha) } }),
      })
      if (!res.ok) throw new Error(`CircleCI trigger_deploy failed: HTTP ${res.status}`)
      const json = await res.json() as { id: string }
      return { runId: json.id }
    },
    write: true,
  },
]

export class CircleciAgent implements IConnectorAgent {
  readonly connectorType = 'circleci'
  readonly tools = TOOLS
}
