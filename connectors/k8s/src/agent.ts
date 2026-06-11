import { spawnSync } from 'node:child_process'
import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

function kubectl(args: string[], creds: Record<string, unknown>): { stdout: string; status: number | null } {
  const kubeconfig = (creds as ConnectorCreds).kubeconfig
  const fullArgs = kubeconfig ? ['--kubeconfig', kubeconfig, ...args] : args
  const result = spawnSync('kubectl', fullArgs, { encoding: 'utf-8', timeout: 15_000 })
  return { stdout: result.stdout ?? '', status: result.status }
}

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_pods', description: 'List pods', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['get', 'pods', '-n', ns, '-o', 'json'], creds)
      if (r.status !== 0) return { pods: [] }
      try {
        const data = JSON.parse(r.stdout) as { items: Array<{ metadata: { name: string }; status: { phase: string }; spec: { containers: Array<{ image: string }> } }> }
        return { pods: data.items.map(p => ({ name: p.metadata.name, status: p.status.phase, image: p.spec.containers[0]?.image ?? '', restarts: 0, namespace: ns })) }
      } catch { return { pods: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'get_deployments', description: 'List deployments', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['get', 'deployments', '-n', ns, '-o', 'json'], creds)
      if (r.status !== 0) return { deployments: [] }
      try {
        const data = JSON.parse(r.stdout) as { items: Array<{ metadata: { name: string }; status: { readyReplicas?: number; replicas?: number }; spec: { template: { spec: { containers: Array<{ image: string }> } } } }> }
        return { deployments: data.items.map(d => ({ name: d.metadata.name, ready: d.status.readyReplicas ?? 0, desired: d.status.replicas ?? 0, image: d.spec.template.spec.containers[0]?.image ?? '' })) }
      } catch { return { deployments: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'get_pod_logs', description: 'Get pod logs', parameters: { type: 'object', properties: { pod: { type: 'string' }, lines: { type: 'number', optional: true }, namespace: { type: 'string', optional: true } }, required: ['pod'] } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['logs', String(params.pod), '-n', ns, '--tail', String(params.lines ?? 100)], creds)
      if (r.status !== 0) return { logs: [] }
      return { logs: r.stdout.split('\n').filter(Boolean) }
    },
    write: false,
  },
  {
    definition: { name: 'get_events', description: 'List recent events', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['get', 'events', '-n', ns, '--sort-by=.lastTimestamp', '-o', 'json'], creds)
      if (r.status !== 0) return { events: [] }
      try {
        const data = JSON.parse(r.stdout) as { items: Array<{ reason: string; message: string; involvedObject: { name: string }; lastTimestamp: string }> }
        return { events: data.items.slice(0, 50).map(e => ({ reason: e.reason, object: e.involvedObject.name, message: e.message, ts: e.lastTimestamp })) }
      } catch { return { events: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'restart_deployment', description: 'Restart a deployment', parameters: { type: 'object', properties: { deployment: { type: 'string' }, namespace: { type: 'string', optional: true } }, required: ['deployment'] } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['rollout', 'restart', 'deployment', String(params.deployment), '-n', ns], creds)
      return { ok: r.status === 0, output: r.stdout || (r.status !== 0 ? 'kubectl rollout restart failed' : '') }
    },
    write: true,
  },
]

export class K8sAgent implements IConnectorAgent {
  readonly connectorType = 'k8s'
  readonly tools = TOOLS
}
