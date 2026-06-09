import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const PD_API = 'https://api.pagerduty.com'

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_active_incidents', description: 'List active incidents', parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } } },
    execute: async (params, creds) => {
      const token = (creds as any).apiKey
      if (!token) return { incidents: [] }
      const url = `${PD_API}/incidents?statuses[]=triggered&statuses[]=acknowledged${params.service ? `&service_ids[]=${params.service}` : ''}`
      const res = await fetch(url, { headers: { Authorization: `Token token=${token}`, Accept: 'application/vnd.pagerduty+json;version=2' } })
      if (!res.ok) return { incidents: [] }
      const json = await res.json() as { incidents?: Array<{ id: string; title: string; severity: string; created_at: string; status: string }> }
      return { incidents: (json.incidents ?? []).map(i => ({ id: i.id, title: i.title, severity: i.severity, startedAt: i.created_at, status: i.status })) }
    },
    write: false,
  },
  {
    definition: { name: 'get_oncall', description: 'Get oncall engineer', parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] } },
    execute: async (params, creds) => {
      const token = (creds as any).apiKey
      if (!token) return { engineer: null }
      const res = await fetch(`${PD_API}/oncalls?team_ids[]=${params.team}&include[]=users`, {
        headers: { Authorization: `Token token=${token}`, Accept: 'application/vnd.pagerduty+json;version=2' },
      })
      if (!res.ok) return { engineer: null }
      const json = await res.json() as { oncalls?: Array<{ user?: { name: string; email: string } }> }
      const user = json.oncalls?.[0]?.user
      return { engineer: user ? { name: user.name, email: user.email, phone: '' } : null }
    },
    write: false,
  },
  { definition: { name: 'create_incident', description: 'Create a new incident', parameters: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string' }, serviceId: { type: 'string' } }, required: ['title', 'severity'] } }, execute: () => Promise.resolve({ id: 'inc-new' }), write: true },
  { definition: { name: 'acknowledge_alert', description: 'Acknowledge an alert', parameters: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] } }, execute: () => Promise.resolve({ ok: true }), write: true },
]

export class PagerdutyAgent implements IConnectorAgent {
  readonly connectorType = 'pagerduty'
  readonly tools = TOOLS
}
