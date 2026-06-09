import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

export class LinearConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const token = process.env['LINEAR_API_KEY']
    if (!token) throw new Error('LINEAR_API_KEY not set')
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    })
    if (!resp.ok) throw new Error(`Linear API ${resp.status}: ${await resp.text()}`)
    const json = await resp.json() as { data?: unknown; errors?: unknown[] }
    if (json.errors?.length) throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`)
    return json.data
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let data: unknown

    switch (query.type) {
      case 'list_issues': {
        data = await this.graphql(
          `query ListIssues($team: String!, $first: Int) {
            issues(first: $first, filter: { team: { name: { eq: $team } } }) {
              nodes { id title description state { name } priority assignee { name } createdAt }
            }
          }`,
          { team: query.team as string ?? '', first: 50 },
        )
        break
      }
      case 'get_issue': {
        data = await this.graphql(
          `query GetIssue($id: String!) {
            issue(id: $id) { id title description state { name } priority assignee { name } team { name } createdAt }
          }`,
          { id: query.issue_id as string ?? '' },
        )
        break
      }
      case 'list_projects': {
        data = await this.graphql(
          `query ListProjects($team: String!, $first: Int) {
            projects(first: $first, filter: { team: { name: { eq: $team } } }) {
              nodes { id name description state { name } startDate targetDate }
            }
          }`,
          { team: query.team as string ?? '', first: 50 },
        )
        break
      }
      case 'get_project': {
        data = await this.graphql(
          `query GetProject($id: String!) {
            project(id: $id) { id name description state { name } startDate targetDate teams { nodes { name } } }
          }`,
          { id: query.project_id as string ?? '' },
        )
        break
      }
      default:
        throw new Error(`Linear connector: unknown query type '${query.type}'`)
    }

    return {
      source: `linear:${this.id}`,
      fetched_at: new Date(),
      ttl: 120,
      freshness_score: 1.0,
      data,
    }
  }

  async write(_action: ConnectorAction): Promise<ConnectorResult> {
    throw new Error('Linear connector is read-only in V1')
  }

  async health(): Promise<HealthStatus> {
    try {
      await this.graphql('{ viewer { id } }', {})
      return { status: 'healthy', lastChecked: new Date() }
    } catch (err) {
      return { status: 'unhealthy', message: String(err), lastChecked: new Date() }
    }
  }
}
