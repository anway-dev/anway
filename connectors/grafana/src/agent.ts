import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_dashboards', description: 'List Grafana dashboards', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as any).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as any).password ?? 'admin'}`)
      try {
        const res = await fetch(`${base}/api/search?type=dash-db`, { headers: { Authorization: `Basic ${auth}` } })
        if (!res.ok) return { dashboards: [] }
        return { dashboards: await res.json() }
      } catch { return { dashboards: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'get_alerts', description: 'List Grafana alerts', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as any).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as any).password ?? 'admin'}`)
      try {
        const res = await fetch(`${base}/api/alerts`, { headers: { Authorization: `Basic ${auth}` } })
        if (!res.ok) return { alerts: [] }
        return { alerts: await res.json() }
      } catch { return { alerts: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'get_datasources', description: 'List Grafana datasources', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as any).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as any).password ?? 'admin'}`)
      try {
        const res = await fetch(`${base}/api/datasources`, { headers: { Authorization: `Basic ${auth}` } })
        if (!res.ok) return { datasources: [] }
        return { datasources: await res.json() }
      } catch { return { datasources: [] } }
    },
    write: false,
  },
]

export class GrafanaAgent implements IConnectorAgent {
  readonly connectorType = 'grafana'
  readonly tools = TOOLS
}
