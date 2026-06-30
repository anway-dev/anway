import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pods', description: 'List pods', parameters: { type: 'object', properties: { namespace: { type: 'string' }, selector: { type: 'string', optional: true } }, required: ['namespace'] } }, execute: () => Promise.resolve({ pods: [{ name:'payments-api-7d9f6',status:'Running',restarts:0,node:'node-3' }] }), write: false },
  { definition: { name: 'get_deployments', description: 'List deployments', parameters: { type: 'object', properties: { namespace: { type: 'string' } }, required: ['namespace'] } }, execute: () => Promise.resolve({ deployments: [{ name:'payments-api',ready:3,desired:3,image:'payments-api:v2.3' }] }), write: false },
  { definition: { name: 'get_pod_logs', description: 'Get pod logs', parameters: { type: 'object', properties: { namespace: { type: 'string' }, pod: { type: 'string' }, lines: { type: 'number', optional: true } }, required: ['namespace', 'pod'] } }, execute: () => Promise.resolve({ logs: ['[INFO] Server started'] }), write: false },
  { definition: { name: 'get_events', description: 'List namespace events', parameters: { type: 'object', properties: { namespace: { type: 'string' } }, required: ['namespace'] } }, execute: () => Promise.resolve({ events: [{ reason:'BackOff',object:'pod/payments-api',message:'Back-off restarting',ts:new Date().toISOString() }] }), write: false },
  {
    definition: { name: 'restart_deployment', description: 'Restart a deployment', parameters: { type: 'object', properties: { namespace: { type: 'string' }, deployment: { type: 'string' } }, required: ['namespace', 'deployment'] } },
    execute: async (params, creds) => {
      const c = creds as ConnectorCreds
      const endpoint = String(c.endpoint ?? '')
      const token = String(c.token ?? '')
      if (!endpoint || !token) throw new Error('GKE credentials not configured')
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/apis/apps/v1/namespaces/${String(params.namespace)}/deployments/${String(params.deployment)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/strategic-merge-patch+json',
        },
        body: JSON.stringify({
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                },
              },
            },
          },
        }),
      })
      if (!res.ok) throw new Error(`GKE restart_deployment failed: HTTP ${res.status}`)
      return { ok: true }
    },
    write: true,
  },
]

export class GkeAgent implements IConnectorAgent {
  readonly connectorType = 'gke'
  readonly tools = TOOLS
}
