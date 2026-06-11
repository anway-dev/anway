import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const DD_API = 'https://api.datadoghq.com'

async function ddApi(path: string, creds: Record<string, unknown>): Promise<unknown | null> {
  const apiKey = (creds as ConnectorCreds).apiKey
  const appKey = (creds as ConnectorCreds).app_key
  if (!apiKey || !appKey) return null
  try {
    const resp = await fetch(`${DD_API}${path}`, {
      headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
    })
    if (!resp.ok) return null
    return await resp.json() as unknown
  } catch { return null }
}

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_metrics', description: 'Fetch metrics for a service', parameters: { type: 'object', properties: { service: { type: 'string' }, window: { type: 'string' }, metric: { type: 'string', optional: true } }, required: ['service', 'window'] } },
    execute: async (params, creds) => {
      const data = await ddApi(`/api/v1/query?query=avg:${(params.metric as string) ?? 'trace.request.hits'}{${params.service}}&from=${Date.now() - 3600_000}&to=${Date.now()}`, creds) as { series?: Array<{ pointlist?: Array<[number, number]> }> } | null
      if (!data?.series) return { points: [], unit: '' }
      const points = data.series.flatMap(s => s.pointlist?.map(([t, v]) => ({ t, v })) ?? [])
      return { points, unit: '' }
    },
    write: false,
  },
  {
    definition: { name: 'get_alerts', description: 'List active alerts', parameters: { type: 'object', properties: { service: { type: 'string', optional: true }, severity: { type: 'string', optional: true } } } },
    execute: async (_params, creds) => {
      const data = await ddApi('/api/v1/monitor', creds) as Array<{ id: number; name: string; type: string; overall_state: string; overall_state_modified?: string }> | null
      if (!data) return { alerts: [] }
      const alerts = data.filter(m => m.overall_state !== 'OK').map(m => ({
        id: String(m.id), title: m.name, severity: m.overall_state === 'Alert' ? 'critical' : 'high', status: m.overall_state === 'Alert' ? 'firing' : 'warn', firedAt: m.overall_state_modified ?? new Date().toISOString(),
      }))
      return { alerts }
    },
    write: false,
  },
  {
    definition: { name: 'get_logs', description: 'Search logs for a service', parameters: { type: 'object', properties: { service: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['service', 'query'] } },
    execute: async (params, creds) => {
      const query = `service:${params.service} ${params.query}`
      const data = await ddApi(`/api/v2/logs/events/search?limit=${params.limit ?? 50}`, creds) as { data?: Array<{ attributes: { timestamp: string; status: string; message: string } }> } | null
      if (!data?.data) return { lines: [] }
      const lines = data.data.map(d => ({ ts: d.attributes.timestamp, level: d.attributes.status, msg: d.attributes.message }))
      return { lines }
    },
    write: false,
  },
]

export class DatadogAgent implements IConnectorAgent {
  readonly connectorType = 'datadog'
  readonly tools = TOOLS
}
