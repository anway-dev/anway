import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_issues', description: 'List issues', parameters: { type: 'object', properties: { project: { type: 'string' }, state: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }, required: ['project'] } }, execute: () => Promise.resolve({ issues: [{ id:'i-1',title:'Fix checkout bug',status:'open',assignee:'bob',priority:'high' }] }), write: false },
  { definition: { name: 'get_issue', description: 'Get issue details', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }, execute: () => Promise.resolve({ issue: { id:'i-1',title:'Fix checkout bug',description:'...',status:'open' } }), write: false },
  {
    definition: { name: 'create_issue', description: 'Create an issue', parameters: { type: 'object', properties: { project: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', optional: true }, labels: { type: 'array', items: { type: 'string' }, optional: true } }, required: ['project', 'title'] } },
    execute: async (params, creds) => {
      const c = creds as ConnectorCreds
      const baseUrl = String(c.baseUrl ?? '')
      const email = String(c.email ?? '')
      const apiKey = String(c.apiKey ?? '')
      if (!baseUrl || !email || !apiKey) throw new Error('Jira API credentials not configured')
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${email}:${apiKey}`)}`,
        },
        body: JSON.stringify({
          fields: {
            project: { key: String(params.project) },
            summary: String(params.title),
            issuetype: { name: 'Task' },
            description: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: String(params.description ?? '') }] }],
            },
          },
        }),
      })
      if (!res.ok) throw new Error(`Jira create_issue failed: HTTP ${res.status}`)
      const json = await res.json() as { id: string }
      return { id: json.id }
    },
    write: true,
  },
  {
    definition: { name: 'update_issue', description: 'Update issue status', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } }, required: ['id', 'status'] } },
    execute: async (params, creds) => {
      const c = creds as ConnectorCreds
      const baseUrl = String(c.baseUrl ?? '')
      const email = String(c.email ?? '')
      const apiKey = String(c.apiKey ?? '')
      if (!baseUrl || !email || !apiKey) throw new Error('Jira API credentials not configured')
      const auth = `Basic ${btoa(`${email}:${apiKey}`)}`
      const issueId = String(params.id)
      const targetStatus = String(params.status).toLowerCase()
      // Step 1: get available transitions
      const tRes = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueId}/transitions`, {
        headers: { Authorization: auth },
      })
      if (!tRes.ok) throw new Error(`Jira update_issue failed: HTTP ${tRes.status}`)
      const tJson = await tRes.json() as { transitions?: Array<{ id: string; name: string }> }
      const transition = (tJson.transitions ?? []).find(t => t.name.toLowerCase() === targetStatus)
      if (!transition) throw new Error('Jira: no transition found for status: ' + String(params.status))
      // Step 2: apply transition
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueId}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ transition: { id: transition.id } }),
      })
      if (!res.ok) throw new Error(`Jira update_issue failed: HTTP ${res.status}`)
      return { ok: true }
    },
    write: true,
  },
]

export class JiraAgent implements IConnectorAgent {
  readonly connectorType = 'jira'
  readonly tools = TOOLS
}
