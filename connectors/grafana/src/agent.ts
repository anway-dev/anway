import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_dashboards', description: 'List Grafana dashboards', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as ConnectorCreds).password ?? 'admin'}`)
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
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as ConnectorCreds).password ?? 'admin'}`)
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
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as ConnectorCreds).password ?? 'admin'}`)
      try {
        const res = await fetch(`${base}/api/datasources`, { headers: { Authorization: `Basic ${auth}` } })
        if (!res.ok) return { datasources: [] }
        return { datasources: await res.json() }
      } catch { return { datasources: [] } }
    },
    write: false,
  },
  {
    definition: {
      name: 'create_dashboard',
      description: 'Create or update a Grafana dashboard',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          panels: { type: 'array' },
          datasourceUid: { type: 'string', optional: true },
          folderId: { type: 'number', optional: true },
        },
        required: ['title', 'panels'],
      },
    },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3001'
      const token = (creds as ConnectorCreds).token as string | undefined
      const authHeader = token ? `Bearer ${token}` : `Basic ${btoa(`admin:${(creds as ConnectorCreds).password ?? 'admin'}`)}`
      const dashboard = {
        id: null,
        uid: undefined as string | undefined,
        title: params.title as string,
        panels: params.panels as object[],
        schemaVersion: 36,
        version: 0,
        refresh: '30s',
        time: { from: 'now-1h', to: 'now' },
      }
      try {
        const res = await fetch(`${base}/api/dashboards/db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ dashboard, overwrite: true, folderId: (params.folderId as number | undefined) ?? 0 }),
        })
        const data = await res.json() as { uid?: string; url?: string; status?: string; message?: string }
        if (!res.ok) return { ok: false, error: data.message ?? `Grafana ${res.status}` }
        return { ok: true, uid: data.uid, url: data.url }
      } catch (err) { return { ok: false, error: String(err) } }
    },
    write: true,
  },
]

export class GrafanaAgent implements IConnectorAgent {
  readonly connectorType = 'grafana'
  readonly tools = TOOLS
}
