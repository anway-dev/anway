import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const PD_API = 'https://api.pagerduty.com'

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_active_incidents', description: 'List active incidents', parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) throw new Error('PagerDuty API key not configured')
      const url = `${PD_API}/incidents?statuses[]=triggered&statuses[]=acknowledged${params.service ? `&service_ids[]=${params.service}` : ''}`
      const res = await fetch(url, { headers: { Authorization: `Token token=${token}`, Accept: 'application/vnd.pagerduty+json;version=2' } })
      if (!res.ok) throw new Error(`PagerDuty get_active_incidents failed: HTTP ${res.status}`)
      const json = await res.json() as { incidents?: Array<{ id: string; title: string; severity: string; created_at: string; status: string }> }
      return { incidents: (json.incidents ?? []).map(i => ({ id: i.id, title: i.title, severity: i.severity, startedAt: i.created_at, status: i.status })) }
    },
    write: false,
  },
  {
    definition: { name: 'get_oncall', description: 'Get oncall engineer', parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) throw new Error('PagerDuty API key not configured')
      const res = await fetch(`${PD_API}/oncalls?team_ids[]=${params.team}&include[]=users`, {
        headers: { Authorization: `Token token=${token}`, Accept: 'application/vnd.pagerduty+json;version=2' },
      })
      if (!res.ok) throw new Error(`PagerDuty get_oncall failed: HTTP ${res.status}`)
      const json = await res.json() as { oncalls?: Array<{ user?: { name: string; email: string } }> }
      const user = json.oncalls?.[0]?.user
      return { engineer: user ? { name: user.name, email: user.email, phone: '' } : null }
    },
    write: false,
  },
  {
    definition: { name: 'create_incident', description: 'Create a new incident', parameters: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string' }, serviceId: { type: 'string' } }, required: ['title', 'severity'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) throw new Error('PagerDuty API key not configured')
      const res = await fetch(`${PD_API}/incidents`, {
        method: 'POST',
        headers: { Authorization: `Token token=${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.pagerduty+json;version=2', From: 'anway-bot@anway.io' },
        body: JSON.stringify({ incident: { type: 'incident', title: String(params.title ?? ''), service: { id: String(params.serviceId ?? ''), type: 'service_reference' }, urgency: params.severity || 'high' } }),
      })
      if (!res.ok) throw new Error(`PagerDuty create_incident failed: HTTP ${res.status}`)
      const json = await res.json() as { incident?: { id: string } }
      if (!json.incident?.id) throw new Error('PagerDuty create_incident failed: no incident id in response')
      return { id: json.incident.id }
    },
    write: true,
  },
  {
    definition: { name: 'acknowledge_alert', description: 'Acknowledge an alert', parameters: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) throw new Error('PagerDuty API key not configured')
      const alertId = String(params.alertId ?? '')
      if (!alertId) throw new Error('alertId is required')
      const res = await fetch(`${PD_API}/alerts/${alertId}`, {
        method: 'PUT',
        headers: { Authorization: `Token token=${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.pagerduty+json;version=2', From: 'anway-bot@anway.io' },
        body: JSON.stringify({ alerts: [{ id: alertId, status: 'acknowledged' }] }),
      })
      if (!res.ok) throw new Error(`PagerDuty acknowledge_alert failed: HTTP ${res.status}`)
      return { ok: true }
    },
    write: true,
  },
]

export class PagerdutyAgent implements IConnectorAgent {
  readonly connectorType = 'pagerduty'
  readonly tools = TOOLS
}
