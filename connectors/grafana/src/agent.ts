import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_metrics', description: 'Fetch metrics for a service', parameters: { type: 'object', properties: { service: { type: 'string' }, window: { type: 'string' }, metric: { type: 'string', optional: true } }, required: ['service', 'window'] } },
    execute: () => Promise.resolve({ points: Array.from({length:12},(_,i)=>({t:Date.now()-(11-i)*300_000,v:0.01+Math.random()*0.05})), unit: 'requests/s' }),
    write: false,
  },
  {
    definition: { name: 'get_alerts', description: 'List active alerts', parameters: { type: 'object', properties: { service: { type: 'string', optional: true }, severity: { type: 'string', optional: true } } } },
    execute: () => Promise.resolve({ alerts: [{ id:'al-1',title:'High error rate',severity:'critical',status:'firing',firedAt:new Date().toISOString() }] }),
    write: false,
  },
  {
    definition: { name: 'get_logs', description: 'Search logs for a service', parameters: { type: 'object', properties: { service: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['service', 'query'] } },
    execute: () => Promise.resolve({ lines: [{ ts: new Date().toISOString(), level: 'error', msg: 'Sample log line' }] }),
    write: false,
  },
]

export class GrafanaAgent implements IConnectorAgent {
  readonly connectorType = 'grafana'
  readonly tools = TOOLS
}
