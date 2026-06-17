import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } }, execute: () => Promise.resolve({ pipelines: [{ id:'pl-1',name:'Deploy',status:'passed',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } }, execute: () => Promise.resolve({ builds: [{ id:'b-1',sha:'abc123',status:'success',duration:120,startedAt:new Date().toISOString() }] }), write: false },
  {
    definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('Vercel API key not configured')
      const res = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name: String(params.service), gitSource: { type: 'github', ref: String(params.sha) }, target: String(params.env) }),
      })
      if (!res.ok) throw new Error(`Vercel trigger_deploy failed: HTTP ${res.status}`)
      const json = await res.json() as { id: string }
      return { runId: json.id }
    },
    write: true,
  },
]

export class VercelAgent implements IConnectorAgent {
  readonly connectorType = 'vercel'
  readonly tools = TOOLS
}
