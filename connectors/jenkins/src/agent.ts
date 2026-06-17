import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } }, execute: () => Promise.resolve({ pipelines: [{ id:'pl-1',name:'Deploy',status:'passed',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } }, execute: () => Promise.resolve({ builds: [{ id:'b-1',sha:'abc123',status:'success',duration:120,startedAt:new Date().toISOString() }] }), write: false },
  {
    definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } },
    execute: async (params, creds) => {
      const c = creds as ConnectorCreds
      const baseUrl = String(c.baseUrl ?? '')
      const user = String(c.user ?? '')
      const apiToken = String(c.apiToken ?? '')
      if (!baseUrl || !user || !apiToken) throw new Error('Jenkins credentials not configured')
      const url = `${baseUrl.replace(/\/$/, '')}/job/${String(params.service)}/buildWithParameters?env=${encodeURIComponent(String(params.env))}&sha=${encodeURIComponent(String(params.sha))}`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${user}:${apiToken}`)}`,
        },
      })
      if (!res.ok) throw new Error(`Jenkins trigger_deploy failed: HTTP ${res.status}`)
      const location = res.headers.get('Location')
      const queueId = location ? location.split('/').pop() ?? 'queued' : 'queued'
      return { runId: queueId }
    },
    write: true,
  },
]

export class JenkinsAgent implements IConnectorAgent {
  readonly connectorType = 'jenkins'
  readonly tools = TOOLS
}
