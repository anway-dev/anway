import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


interface JiraIssueFields {
  summary?: string
  status?: { name?: string }
  assignee?: { displayName?: string } | null
  priority?: { name?: string }
  description?: unknown
}
interface JiraIssue { key: string; fields: JiraIssueFields }

function jiraAuthHeader(c: ConnectorCreds): { baseUrl: string; auth: string } {
  const baseUrl = String(c.baseUrl ?? '')
  const email = String(c.email ?? '')
  const apiKey = String(c.apiKey ?? '')
  if (!baseUrl || !email || !apiKey) throw new Error('Jira API credentials not configured')
  return { baseUrl: baseUrl.replace(/\/$/, ''), auth: `Basic ${btoa(`${email}:${apiKey}`)}` }
}

const TOOLS: ConnectorTool[] = [
  {
    // These two tools were hardcoded fake data ({ id:'i-1', title:'Fix checkout
    // bug', assignee:'bob' }) — confirmed live via independent review to be
    // the *only* tools the orchestrator sees for this connector (write:true
    // tools are filtered out of chat in V1), so any agent asked about real
    // Jira issues was grounding its answer in fabricated data. Real Jira
    // Cloud REST API v3 search, matching the same Basic-auth pattern already
    // used by create_issue/update_issue below.
    definition: { name: 'get_issues', description: 'List issues', parameters: { type: 'object', properties: { project: { type: 'string' }, state: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }, required: ['project'] } },
    execute: async (params, creds) => {
      const { baseUrl, auth } = jiraAuthHeader(creds as ConnectorCreds)
      const project = String(params.project)
      const state = params.state ? String(params.state) : undefined
      const limit = params.limit ? Number(params.limit) : 50
      let jql = `project = "${project.replace(/"/g, '\\"')}"`
      if (state) jql += ` AND status = "${state.replace(/"/g, '\\"')}"`
      const url = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=summary,status,assignee,priority`
      const res = await fetch(url, { headers: { Authorization: auth } })
      if (!res.ok) throw new Error(`Jira get_issues failed: HTTP ${res.status}`)
      const json = await res.json() as { issues?: JiraIssue[] }
      return {
        issues: (json.issues ?? []).map(i => ({
          id: i.key,
          title: i.fields.summary ?? '',
          status: i.fields.status?.name ?? 'unknown',
          assignee: i.fields.assignee?.displayName ?? null,
          priority: i.fields.priority?.name ?? null,
        })),
      }
    },
    write: false,
  },
  {
    definition: { name: 'get_issue', description: 'Get issue details', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    execute: async (params, creds) => {
      const { baseUrl, auth } = jiraAuthHeader(creds as ConnectorCreds)
      const id = String(params.id)
      const res = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(id)}?fields=summary,description,status,assignee,priority`, {
        headers: { Authorization: auth },
      })
      if (!res.ok) throw new Error(`Jira get_issue failed: HTTP ${res.status}`)
      const json = await res.json() as JiraIssue
      return {
        issue: {
          id: json.key,
          title: json.fields.summary ?? '',
          description: json.fields.description ?? '',
          status: json.fields.status?.name ?? 'unknown',
        },
      }
    },
    write: false,
  },
  {
    definition: { name: 'create_issue', description: 'Create an issue', parameters: { type: 'object', properties: { project: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', optional: true }, labels: { type: 'array', items: { type: 'string' }, optional: true } }, required: ['project', 'title'] } },
    execute: async (params, creds) => {
      const { baseUrl, auth } = jiraAuthHeader(creds as ConnectorCreds)
      const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
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
      const { baseUrl, auth } = jiraAuthHeader(creds as ConnectorCreds)
      const issueId = String(params.id)
      const targetStatus = String(params.status).toLowerCase()
      // Step 1: get available transitions
      const tRes = await fetch(`${baseUrl}/rest/api/3/issue/${issueId}/transitions`, {
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
