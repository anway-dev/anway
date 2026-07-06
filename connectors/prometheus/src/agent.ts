import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'prometheus.query_metrics', description: 'Run PromQL instant query', parameters: { type: 'object', properties: { query: { type: 'string' }, window: { type: 'string', optional: true } }, required: ['query'] } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:9090'
      const q = encodeURIComponent(params.query as string)
      const res = await fetch(`${base}/api/v1/query?query=${q}`)
      if (!res.ok) throw new Error(`Prometheus query_metrics failed: HTTP ${res.status}`)
      const data = await res.json() as { data: { result: unknown[] } }
      return { result: data.data.result }
    },
    write: false,
  },
  {
    definition: { name: 'prometheus.get_alerts', description: 'List active alerts', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:9090'
      const res = await fetch(`${base}/api/v1/alerts`)
      if (!res.ok) throw new Error(`Prometheus get_alerts failed: HTTP ${res.status}`)
      const data = await res.json() as { data: { alerts: unknown[] } }
      return { alerts: data.data.alerts ?? [] }
    },
    write: false,
  },
  {
    definition: { name: 'prometheus.get_targets', description: 'List scrape targets', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:9090'
      const res = await fetch(`${base}/api/v1/targets`)
      if (!res.ok) throw new Error(`Prometheus get_targets failed: HTTP ${res.status}`)
      const data = await res.json() as { data: { activeTargets: unknown[] } }
      return { targets: data.data.activeTargets ?? [] }
    },
    write: false,
  },
]

export class PrometheusAgent implements IConnectorAgent {
  readonly connectorType = 'prometheus'
  readonly tools = TOOLS
}
