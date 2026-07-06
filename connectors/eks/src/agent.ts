import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


function eksAuth(creds: ConnectorCreds): { endpoint: string; token: string } {
  const endpoint = String(creds.endpoint ?? '')
  const token = String(creds.token ?? '')
  if (!endpoint || !token) throw new Error('EKS credentials not configured')
  return { endpoint: endpoint.replace(/\/$/, ''), token }
}

interface K8sPod { metadata: { name: string }; status?: { phase?: string; containerStatuses?: Array<{ restartCount?: number }> }; spec?: { nodeName?: string } }
interface K8sDeployment { metadata: { name: string }; status?: { readyReplicas?: number; replicas?: number }; spec?: { replicas?: number; template?: { spec?: { containers?: Array<{ image?: string }> } } } }
interface K8sEvent { reason?: string; involvedObject?: { kind?: string; name?: string }; message?: string; lastTimestamp?: string; eventTime?: string }

const TOOLS: ConnectorTool[] = [
  {
    // These 4 read tools were hardcoded fake data previously — confirmed live
    // via independent review these are the only tools the orchestrator sees
    // for this connector (write:true tools are filtered out of chat in V1).
    // Real Kubernetes API via the same raw REST + bearer-token pattern
    // already used by restart_deployment below.
    definition: { name: 'get_pods', description: 'List pods', parameters: { type: 'object', properties: { namespace: { type: 'string' }, selector: { type: 'string', optional: true } }, required: ['namespace'] } },
    execute: async (params, creds) => {
      const { endpoint, token } = eksAuth(creds as ConnectorCreds)
      const selector = params.selector ? `?labelSelector=${encodeURIComponent(String(params.selector))}` : ''
      const res = await fetch(`${endpoint}/api/v1/namespaces/${String(params.namespace)}/pods${selector}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`EKS get_pods failed: HTTP ${res.status}`)
      const json = await res.json() as { items?: K8sPod[] }
      return {
        pods: (json.items ?? []).map(p => ({
          name: p.metadata.name,
          status: p.status?.phase ?? 'Unknown',
          restarts: (p.status?.containerStatuses ?? []).reduce((sum, c) => sum + (c.restartCount ?? 0), 0),
          node: p.spec?.nodeName ?? null,
        })),
      }
    },
    write: false,
  },
  {
    definition: { name: 'get_deployments', description: 'List deployments', parameters: { type: 'object', properties: { namespace: { type: 'string' } }, required: ['namespace'] } },
    execute: async (params, creds) => {
      const { endpoint, token } = eksAuth(creds as ConnectorCreds)
      const res = await fetch(`${endpoint}/apis/apps/v1/namespaces/${String(params.namespace)}/deployments`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`EKS get_deployments failed: HTTP ${res.status}`)
      const json = await res.json() as { items?: K8sDeployment[] }
      return {
        deployments: (json.items ?? []).map(d => ({
          name: d.metadata.name,
          ready: d.status?.readyReplicas ?? 0,
          desired: d.spec?.replicas ?? d.status?.replicas ?? 0,
          image: d.spec?.template?.spec?.containers?.[0]?.image ?? null,
        })),
      }
    },
    write: false,
  },
  {
    definition: { name: 'get_pod_logs', description: 'Get pod logs', parameters: { type: 'object', properties: { namespace: { type: 'string' }, pod: { type: 'string' }, lines: { type: 'number', optional: true } }, required: ['namespace', 'pod'] } },
    execute: async (params, creds) => {
      const { endpoint, token } = eksAuth(creds as ConnectorCreds)
      const lines = params.lines ? Number(params.lines) : 100
      // The kubelet log endpoint returns plain text, not JSON.
      const res = await fetch(`${endpoint}/api/v1/namespaces/${String(params.namespace)}/pods/${String(params.pod)}/log?tailLines=${lines}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`EKS get_pod_logs failed: HTTP ${res.status}`)
      const text = await res.text()
      return { logs: text.split('\n').filter(l => l.length > 0) }
    },
    write: false,
  },
  {
    definition: { name: 'get_events', description: 'List namespace events', parameters: { type: 'object', properties: { namespace: { type: 'string' } }, required: ['namespace'] } },
    execute: async (params, creds) => {
      const { endpoint, token } = eksAuth(creds as ConnectorCreds)
      const res = await fetch(`${endpoint}/api/v1/namespaces/${String(params.namespace)}/events`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`EKS get_events failed: HTTP ${res.status}`)
      const json = await res.json() as { items?: K8sEvent[] }
      return {
        events: (json.items ?? []).map(e => ({
          reason: e.reason ?? 'Unknown',
          object: e.involvedObject ? `${e.involvedObject.kind ?? 'object'}/${e.involvedObject.name ?? ''}` : null,
          message: e.message ?? '',
          ts: e.lastTimestamp ?? e.eventTime ?? null,
        })),
      }
    },
    write: false,
  },
  {
    definition: { name: 'restart_deployment', description: 'Restart a deployment', parameters: { type: 'object', properties: { namespace: { type: 'string' }, deployment: { type: 'string' } }, required: ['namespace', 'deployment'] } },
    execute: async (params, creds) => {
      const { endpoint, token } = eksAuth(creds as ConnectorCreds)
      const res = await fetch(`${endpoint}/apis/apps/v1/namespaces/${String(params.namespace)}/deployments/${String(params.deployment)}`, {
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
      if (!res.ok) throw new Error(`EKS restart_deployment failed: HTTP ${res.status}`)
      return { ok: true }
    },
    write: true,
  },
]

export class EksAgent implements IConnectorAgent {
  readonly connectorType = 'eks'
  readonly tools = TOOLS
}
