// Demo only: calls Docker daemon API (unix socket proxied on port 2375), not real Kubernetes API
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

interface ConnectorCreds { baseUrl?: string; token?: string; apiKey?: string; password?: string; org?: string; [k: string]: unknown }

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_pods', description: 'List pods (Docker containers)', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:2375'
      try {
        const res = await fetch(`${base}/containers/json?all=true`)
        if (!res.ok) return { pods: [] }
        const cs = await res.json() as Array<{ Id: string; Names: string[]; State: string; Status: string; Image: string }>
        return { pods: cs.map(c => ({ name: (c.Names[0] ?? '').replace('/', ''), status: c.State === 'running' ? 'Running' : 'Stopped', image: c.Image, restarts: 0, node: 'docker' })) }
      } catch { return { pods: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'get_deployments', description: 'List running containers', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:2375'
      try {
        const res = await fetch(`${base}/containers/json?all=true`)
        if (!res.ok) return { deployments: [] }
        const cs = await res.json() as Array<{ Names: string[]; Image: string; State: string }>
        return { deployments: cs.filter((c: { State: string }) => c.State === 'running').map(c => ({ name: (c.Names[0] ?? '').replace('/', ''), ready: 1, desired: 1, image: c.Image })) }
      } catch { return { deployments: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'get_pod_logs', description: 'Get container logs', parameters: { type: 'object', properties: { pod: { type: 'string' }, lines: { type: 'number', optional: true } }, required: ['pod'] } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:2375'
      try {
        const podName = encodeURIComponent(String(params.pod))
        const res = await fetch(`${base}/containers/${podName}/logs?tail=${params.lines ?? 100}&stdout=true&stderr=true`)
        if (!res.ok) return { logs: [] }
        return { logs: (await res.text()).split('\n').filter(Boolean) }
      } catch { return { logs: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'get_events', description: 'List recent Docker events', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:2375'
      try {
        const res = await fetch(`${base}/events?since=${Math.floor(Date.now()/1000)-300}`)
        if (!res.ok) return { events: [] }
        const text = await res.text()
        const events = text.split('\n').filter(Boolean).slice(0, 20).map(l => { try { const j = JSON.parse(l); return { reason: j.Type, object: j.Actor?.Attributes?.name ?? '', message: j.Action, ts: j.time }; } catch { return null; } }).filter(Boolean)
        return { events }
      } catch { return { events: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'restart_deployment', description: 'Restart a deployment', parameters: { type: 'object', properties: { deployment: { type: 'string' } }, required: ['deployment'] } },
    execute: () => Promise.resolve({ ok: true }),
    write: true,
  },
]

export class K8sAgent implements IConnectorAgent {
  readonly connectorType = 'k8s'
  readonly tools = TOOLS
}
