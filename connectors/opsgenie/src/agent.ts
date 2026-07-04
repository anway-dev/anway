import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


function mapPriority(priority: string): string {
  const p = (priority ?? '').toUpperCase()
  switch (p) {
    case 'P1': return 'critical'
    case 'P2': return 'high'
    case 'P3': return 'moderate'
    case 'P4': return 'low'
    case 'P5': return 'info'
    default: return p || 'unknown'
  }
}

function resolveCreds(creds: unknown): { apiKey: string; baseUrl: string } {
  const c = creds as ConnectorCreds
  const apiKey = c.apiKey ?? process.env['OPSGENIE_API_KEY'] ?? ''
  if (!apiKey) throw new Error('OpsGenie API key not configured')
  const baseUrl = c.baseUrl ?? 'https://api.opsgenie.com'
  return { apiKey, baseUrl }
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_active_incidents',
      description: 'List active (open) incidents. Note: OpsGenie incidents lack a native "service" field — the optional "service" param is accepted for API compatibility but does not apply a server-side filter.',
      parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } },
    },
    execute: async (params, creds) => {
      const { apiKey, baseUrl } = resolveCreds(creds)
      const url = `${baseUrl}/v1/incidents?query=${encodeURIComponent('status=open')}`
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
      })
      if (!res.ok) throw new Error(`OpsGenie get_active_incidents failed: HTTP ${res.status}`)
      const json = await res.json() as { data?: Array<{ id: string; message: string; priority?: string; createdAt: string; status: string }> }
      const incidents = (json.data ?? []).map(inc => ({
        id: inc.id,
        title: inc.message,
        severity: mapPriority(inc.priority ?? ''),
        startedAt: inc.createdAt,
        status: inc.status,
      }))
      return { incidents }
    },
    write: false,
  },
  {
    definition: {
      name: 'get_oncall',
      description: 'Get current on-call engineer for a team. Resolves team name → schedule → on-call participants via OpsGenie API. Phone numbers are not exposed by the on-call endpoint and will be null.',
      parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] },
    },
    execute: async (params, creds) => {
      const { apiKey, baseUrl } = resolveCreds(creds)
      const team = String(params.team)
      if (!team) throw new Error('team is required')

      // Step 1: list schedules, find one owned by the target team
      const schedResp = await fetch(`${baseUrl}/v2/schedules`, {
        headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
      })
      if (!schedResp.ok) throw new Error(`OpsGenie get_oncall schedules failed: HTTP ${schedResp.status}`)
      const schedJson = await schedResp.json() as { data?: Array<{ id: string; name: string; ownerTeam?: { id: string; name: string } }> }
      const schedules = schedJson.data ?? []
      const teamSchedule = schedules.find(s => s.ownerTeam?.name?.toLowerCase() === team.toLowerCase())
      if (!teamSchedule) throw new Error(`OpsGenie get_oncall: no schedule found for team "${team}"`)

      // Step 2: fetch on-calls for the resolved schedule
      const oncallResp = await fetch(`${baseUrl}/v2/schedules/${teamSchedule.id}/on-calls?scheduleIdentifierType=id`, {
        headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
      })
      if (!oncallResp.ok) throw new Error(`OpsGenie get_oncall on-calls failed: HTTP ${oncallResp.status}`)
      const oncallJson = await oncallResp.json() as {
        // Real API: data is a single object
        data?: { onCallParticipants?: Array<{ name: string; type: string }>; onCallRecipients?: string[] }
        // Bootstrap fixture compat: data is an array of {onCallRecipients}
        | Array<{ onCallRecipients?: string[] }>
      }
      const rawData = oncallJson.data

      // Handle both shapes: real API returns object, fixture may return array
      const participants: Array<{ name: string; type: string }> = []
      const recipients: string[] = []

      if (rawData && !Array.isArray(rawData)) {
        // Object shape (real API)
        const obj = rawData as { onCallParticipants?: Array<{ name: string; type: string }>; onCallRecipients?: string[] }
        if (obj.onCallParticipants) participants.push(...obj.onCallParticipants)
        if (obj.onCallRecipients) recipients.push(...obj.onCallRecipients)
      } else if (Array.isArray(rawData)) {
        // Array shape (bootstrap fixture compat)
        for (const entry of rawData) {
          if (entry.onCallRecipients) recipients.push(...entry.onCallRecipients)
        }
      }

      // Prefer user-type participants with name containing @ (email-style)
      const userParticipants = participants.filter(p => p.type === 'user')
      if (userParticipants.length > 0) {
        const primary = userParticipants[0]!
        return {
          engineer: {
            name: primary.name,
            email: primary.name.includes('@') ? primary.name : null,
            phone: null, // OpsGenie on-call API does not expose phone numbers
          },
        }
      }

      if (recipients.length > 0) {
        const name = recipients[0]!
        return {
          engineer: {
            name,
            email: name.includes('@') ? name : null,
            phone: null,
          },
        }
      }

      throw new Error('OpsGenie get_oncall: no on-call participants found')
    },
    write: false,
  },
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
