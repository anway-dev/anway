import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'loki.query_logs', description: 'Query logs using LogQL', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['query'] } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3100'
      const q = encodeURIComponent(params.query as string)
      const end = Date.now() * 1e6
      const start = end - 3600 * 1e9
      try {
        const res = await fetch(`${base}/loki/api/v1/query_range?query=${q}&start=${start}&end=${end}&limit=${params.limit ?? 100}`)
        if (!res.ok) return { lines: [], error: `Loki ${res.status}` }
        const data = await res.json() as { data: { result: Array<{ stream: Record<string, string>; values: string[][] }> } }
        const lines = data.data.result.flatMap(s => s.values.map(([ts, msg]) => ({ ts, stream: s.stream, msg })))
        return { lines }
      } catch { return { lines: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'loki.get_labels', description: 'List available log labels', parameters: { type: 'object', properties: {} } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3100'
      try {
        const res = await fetch(`${base}/loki/api/v1/label`)
        if (!res.ok) return { labels: [] }
        const data = await res.json() as { data: string[] }
        return { labels: data.data ?? [] }
      } catch { return { labels: [] } }
    },
    write: false,
  },
  {
    definition: { name: 'loki.get_log_volume', description: 'Get log volume for a service', parameters: { type: 'object', properties: { service: { type: 'string' }, window: { type: 'string' } }, required: ['service'] } },
    execute: async (params, creds) => {
      const base = (creds as ConnectorCreds).baseUrl ?? 'http://localhost:3100'
      const escapedService = String(params.service).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '\\"')
      const q = encodeURIComponent(`{container=~".*${escapedService}.*"}`)
      try {
        const res = await fetch(`${base}/loki/api/v1/query_range?query=count_over_time(${q}[1m])&limit=1`)
        if (!res.ok) return { points: [] }
        const lokiData = await res.json() as { data: { result: Array<{ values: [string, string][] }> } }
        const points = lokiData.data.result.flatMap(r => r.values.map(([ts, v]) => ({ t: Number(ts) / 1e6, v: Number(v) })))
        return { points: points.length ? points : [{ t: Date.now(), v: 0 }] }
      } catch { return { points: [] } }
    },
    write: false,
  },
]

export class LokiAgent implements IConnectorAgent {
  readonly connectorType = 'loki'
  readonly tools = TOOLS
}
