import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'


const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'prometheus.query_metrics', description: 'Run PromQL instant query', parameters: { type: 'object', properties: { query: { type: 'string' }, window: { type: 'string', optional: true } }, required: ['query'] } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:9090'
      const q = encodeURIComponent(params.query as string)
      try {
        const res = await fetch(`${base}/api/v1/query?query=${q}`)
        if (!res.ok) return { error: `Prometheus ${res.status}` }
        const data = await res.json() as { data: { result: unknown[] } }
        return { result: data.data.result }
      } catch { return { error: 'Prometheus unreachable' } }
    },
    write: false,
  },
  {
    definition: { name: 'prometheus.get_alerts', description: 'List active alerts', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:9090'
      try {
        const res = await fetch(`${base}/api/v1/alerts`)
        if (!res.ok) return { alerts: [] }
        const data = await res.json() as { data: { alerts: unknown[] } }
        return { alerts: data.data.alerts ?? [] }
      } catch { return { alerts: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'prometheus.get_targets', description: 'List scrape targets', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:9090'
      try {
        const res = await fetch(`${base}/api/v1/targets`)
        if (!res.ok) return { targets: [] }
        const data = await res.json() as { data: { activeTargets: unknown[] } }
        return { targets: data.data.activeTargets ?? [] }
      } catch { return { targets: [] } }
    },
    write: false,
  },
]

export class PrometheusAgent implements IConnectorAgent {
  readonly connectorType = 'prometheus'
  readonly tools = TOOLS
}
