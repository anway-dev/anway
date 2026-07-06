import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  {
    // These 3 read tools previously swallowed every real error (network
    // failure, auth failure, Grafana down) into the same empty-array
    // "success" as a genuinely empty result — confirmed live via
    // independent review as a systemic pattern across many connectors,
    // masking real outages as "all clear". A real error now throws instead;
    // a genuine 200-OK-but-empty response is unaffected.
    definition: { name: 'get_dashboards', description: 'List Grafana dashboards', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as ConnectorCreds).password ?? 'admin'}`)
      const res = await fetch(`${base}/api/search?type=dash-db`, { headers: { Authorization: `Basic ${auth}` } })
      if (!res.ok) throw new Error(`Grafana get_dashboards failed: HTTP ${res.status}`)
      return { dashboards: await res.json() }
    },
    write: false,
  },
  {
    definition: { name: 'get_alerts', description: 'List Grafana alerts', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as ConnectorCreds).password ?? 'admin'}`)
      const res = await fetch(`${base}/api/alerts`, { headers: { Authorization: `Basic ${auth}` } })
      if (!res.ok) throw new Error(`Grafana get_alerts failed: HTTP ${res.status}`)
      return { alerts: await res.json() }
    },
    write: false,
  },
  {
    definition: { name: 'get_datasources', description: 'List Grafana datasources', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3001'
      const auth = btoa(`admin:${(creds as ConnectorCreds).password ?? 'admin'}`)
      const res = await fetch(`${base}/api/datasources`, { headers: { Authorization: `Basic ${auth}` } })
      if (!res.ok) throw new Error(`Grafana get_datasources failed: HTTP ${res.status}`)
      return { datasources: await res.json() }
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
