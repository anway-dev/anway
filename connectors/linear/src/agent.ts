import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'


const LINEAR_API = 'https://api.linear.app/graphql'

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_issues', description: 'List issues for a team', parameters: { type: 'object', properties: { team: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['team'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) return { issues: [] }
      const query = `query { issues(filter: { team: { key: { eq: "${params.team}" } } }, first: ${params.limit ?? 25}) { nodes { id title state { name } priority assignee { name } } } }`
      const res = await fetch(LINEAR_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) return { issues: [], error: `Linear API ${res.status}` }
      const json = await res.json() as { data?: { issues?: { nodes: Array<{ id: string; title: string; state: { name: string }; priority: number; assignee: { name: string } | null }> } } }
      const nodes = json.data?.issues?.nodes ?? []
      return { issues: nodes.map(n => ({ id: n.id, title: n.title, status: n.state.name, priority: ['none', 'none', 'urgent', 'high', 'medium', 'low'][n.priority] ?? 'none', assignee: n.assignee?.name ?? null })) }
    },
    write: false,
  },
  {
    definition: { name: 'get_projects', description: 'List projects', parameters: { type: 'object', properties: { team: { type: 'string' }, first: { type: 'number', optional: true } }, required: ['team'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) return { projects: [] }
      const query = `query { projects(first: ${params.first ?? 10}, filter: { teams: { key: { eq: "${params.team}" } } }) { nodes { id name description state { name } } } }`
      const res = await fetch(LINEAR_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) return { projects: [] }
      const json = await res.json() as { data?: { projects?: { nodes: Array<{ id: string; name: string; description?: string; state: { name: string } }> } } }
      return { projects: (json.data?.projects?.nodes ?? []).map(n => ({ id: n.id, name: n.name, description: n.description ?? '', state: n.state.name })) }
    },
    write: false,
  },
  {
    definition: { name: 'create_issue', description: 'Create an issue', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string', optional: true }, teamId: { type: 'string' } }, required: ['title', 'teamId'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) throw new Error('Linear API key not configured')
      const mutation = `mutation CreateIssue($title: String!, $teamId: String!) { issueCreate(input: { title: $title, teamId: $teamId }) { success issue { id identifier title url } } }`
      const res = await fetch(LINEAR_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: mutation, variables: { title: String(params.title), teamId: String(params.teamId) } }),
      })
      if (!res.ok) throw new Error(`Linear create_issue failed: HTTP ${res.status}`)
      const json = await res.json() as { data?: { issueCreate?: { success: boolean; issue?: { id: string } } } }
      if (!json.data?.issueCreate?.success || !json.data.issueCreate.issue) throw new Error('Linear create_issue failed: API returned unsuccessful')
      return { id: json.data.issueCreate.issue.id }
    },
    write: true,
  },
]

export class LinearAgent implements IConnectorAgent {
  readonly connectorType = 'linear'
  readonly tools = TOOLS
}
