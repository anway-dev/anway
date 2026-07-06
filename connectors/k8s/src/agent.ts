import { spawnSync } from 'node:child_process'
import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

function kubectl(args: string[], creds: Record<string, unknown>): { stdout: string; stderr: string; status: number | null } {
  const kubeconfig = typeof (creds as ConnectorCreds).kubeconfig === 'string' ? (creds as ConnectorCreds).kubeconfig as string : undefined
  const fullArgs = kubeconfig ? ['--kubeconfig', kubeconfig, ...args] : args
  const result = spawnSync('kubectl', fullArgs, { encoding: 'utf-8', timeout: 15_000 })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

// A nonzero kubectl exit is a real failure (bad kubeconfig, cluster
// unreachable, RBAC denial, namespace not found) — confirmed live via
// independent review that every read tool below previously collapsed this
// into the same empty array a genuinely-empty-but-successful list returns,
// masking real cluster/auth failures as "no pods/deployments/events".
function assertOk(r: { stdout: string; stderr: string; status: number | null }, action: string): void {
  if (r.status !== 0) throw new Error(`kubectl ${action} failed (exit ${r.status}): ${r.stderr.trim() || 'no stderr'}`)
}

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_pods', description: 'List pods', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['get', 'pods', '-n', ns, '-o', 'json'], creds)
      assertOk(r, 'get pods')
      const data = JSON.parse(r.stdout) as { items: Array<{ metadata: { name: string }; status: { phase: string }; spec: { containers: Array<{ image: string }> } }> }
      return { pods: data.items.map(p => ({ name: p.metadata.name, status: p.status.phase, image: p.spec.containers[0]?.image ?? '', restarts: 0, namespace: ns })) }
    },
    write: false,
  },
  {
    definition: { name: 'get_deployments', description: 'List deployments', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['get', 'deployments', '-n', ns, '-o', 'json'], creds)
      assertOk(r, 'get deployments')
      const data = JSON.parse(r.stdout) as { items: Array<{ metadata: { name: string }; status: { readyReplicas?: number; replicas?: number }; spec: { template: { spec: { containers: Array<{ image: string }> } } } }> }
      return { deployments: data.items.map(d => ({ name: d.metadata.name, ready: d.status.readyReplicas ?? 0, desired: d.status.replicas ?? 0, image: d.spec.template.spec.containers[0]?.image ?? '' })) }
    },
    write: false,
  },
  {
    definition: { name: 'get_pod_logs', description: 'Get pod logs', parameters: { type: 'object', properties: { pod: { type: 'string' }, lines: { type: 'number', optional: true }, namespace: { type: 'string', optional: true } }, required: ['pod'] } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['logs', String(params.pod), '-n', ns, '--tail', String(params.lines ?? 100)], creds)
      assertOk(r, 'logs')
      return { logs: r.stdout.split('\n').filter(Boolean) }
    },
    write: false,
  },
  {
    definition: { name: 'get_events', description: 'List recent events', parameters: { type: 'object', properties: { namespace: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const r = kubectl(['get', 'events', '-n', ns, '--sort-by=.lastTimestamp', '-o', 'json'], creds)
      assertOk(r, 'get events')
      const data = JSON.parse(r.stdout) as { items: Array<{ reason: string; message: string; involvedObject: { name: string }; lastTimestamp: string }> }
      return { events: data.items.slice(0, 50).map(e => ({ reason: e.reason, object: e.involvedObject.name, message: e.message, ts: e.lastTimestamp })) }
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
  {
    definition: { name: 'scale_deployment', description: 'Scale a deployment to N replicas', parameters: { type: 'object', properties: { deployment: { type: 'string' }, replicas: { type: 'number' }, namespace: { type: 'string', optional: true } }, required: ['deployment', 'replicas'] } },
    execute: async (params, creds) => {
      const ns = params.namespace as string ?? 'default'
      const replicas = Number(params.replicas ?? 1)
      const r = kubectl(['scale', '--replicas', String(replicas), `deployment/${String(params.deployment)}`, '-n', ns], creds)
      return { ok: r.status === 0, output: r.stdout || (r.status !== 0 ? 'kubectl scale failed' : ''), replicas }
    },
    write: true,
  },
  {
    definition: { name: 'cordon_node', description: 'Cordon a Kubernetes node', parameters: { type: 'object', properties: { node: { type: 'string' } }, required: ['node'] } },
    execute: async (params, creds) => {
      const r = kubectl(['cordon', String(params.node)], creds)
      return { ok: r.status === 0, output: r.stdout || (r.status !== 0 ? 'kubectl cordon failed' : '') }
    },
    write: true,
  },
]

export class K8sAgent implements IConnectorAgent {
  readonly connectorType = 'k8s'
  readonly tools = TOOLS
}
