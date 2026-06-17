import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } }, execute: () => Promise.resolve({ pipelines: [{ id:'pl-1',name:'Deploy',status:'passed',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } }, execute: () => Promise.resolve({ builds: [{ id:'b-1',sha:'abc123',status:'success',duration:120,startedAt:new Date().toISOString() }] }), write: false },
  {
    definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } },
    execute: async (params, creds) => {
      const token = (creds as { token?: string; baseUrl?: string }).token
      if (!token) throw new Error('ArgoCD token not configured')
      const baseUrl = (creds as { token?: string; baseUrl?: string }).baseUrl ?? ''
      if (!baseUrl) throw new Error('ArgoCD URL not configured')
      const appName = String(params.service ?? '')
      if (!appName) throw new Error('service name is required')
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/applications/${appName}/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`ArgoCD trigger_deploy failed: HTTP ${res.status}`)
      const operation = await res.json() as { metadata?: { name?: string }; status?: { operationState?: { id?: string } } }
      return { runId: operation.metadata?.name ?? operation.status?.operationState?.id ?? 'unknown' }
    },
    write: true,
  },
]

export class ArgocdAgent implements IConnectorAgent {
  readonly connectorType = 'argocd'
  readonly tools = TOOLS
}
