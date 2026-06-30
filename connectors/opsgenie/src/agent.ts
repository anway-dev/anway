import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_active_incidents', description: 'List active incidents', parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } } }, execute: () => Promise.resolve({ incidents: [{ id:'inc-1',title:'Payment failures',severity:'critical',startedAt:new Date().toISOString(),status:'triggered' }] }), write: false },
  { definition: { name: 'get_oncall', description: 'Get oncall engineer', parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] } }, execute: () => Promise.resolve({ engineer: { name:'Alice',email:'alice@acme.dev',phone:'+1-555-0100' } }), write: false },
  {
    definition: { name: 'create_incident', description: 'Create a new incident', parameters: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string' }, serviceId: { type: 'string' } }, required: ['title', 'severity'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('OpsGenie API key not configured')
      const body: Record<string, unknown> = { message: String(params.title), priority: String(params.severity).toUpperCase() }
      if (params.serviceId) body['serviceId'] = String(params.serviceId)
      const res = await fetch('https://api.opsgenie.com/v1/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`OpsGenie create_incident failed: HTTP ${res.status}`)
      const json = await res.json() as { data?: { id: string } }
      if (!json.data?.id) throw new Error('OpsGenie create_incident failed: no data.id in response')
      return { id: json.data.id }
    },
    write: true,
  },
  {
    definition: { name: 'acknowledge_alert', description: 'Acknowledge an alert', parameters: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('OpsGenie API key not configured')
      const alertId = String(params.alertId)
      if (!alertId) throw new Error('alertId is required')
      const res = await fetch(`https://api.opsgenie.com/v2/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`OpsGenie acknowledge_alert failed: HTTP ${res.status}`)
      return { ok: true }
    },
    write: true,
  },
]

export class OpsgenieAgent implements IConnectorAgent {
  readonly connectorType = 'opsgenie'
  readonly tools = TOOLS
}
