import { execSync } from 'node:child_process'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

export class LinearConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let data: unknown

    const linearQuery = (graphql: string) => {
      const json = JSON.stringify({ query: graphql })
      const out = execSync(`linear api --json '${json}'`, { encoding: 'utf-8' })
      return JSON.parse(out)
    }

    switch (query.type) {
      case 'list_issues': {
        const team = query.team as string ?? ''
        const filters = query.filters as string ?? ''
        const q = `{ issues(first:50,filter:{team:{name:{eq:\"${team}\"}}}${filters ? ','+filters : ''}) { nodes { id title description state { name } priority assignee { name } createdAt } } }`
        data = linearQuery(q)
        break
      }
      case 'get_issue': {
        const id = query.issue_id as string ?? ''
        data = linearQuery(`{ issue(id:\"${id}\") { id title description state { name } priority assignee { name } team { name } createdAt } }`)
        break
      }
      case 'list_projects': {
        const team = query.team as string ?? ''
        data = linearQuery(`{ projects(first:50,filter:{team:{name:{eq:\"${team}\"}}}) { nodes { id name description state { name } startDate targetDate } } }`)
        break
      }
      case 'get_project': {
        const id = query.project_id as string ?? ''
        data = linearQuery(`{ project(id:\"${id}\") { id name description state { name } startDate targetDate teams { name } } }`)
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
      const out = execSync('linear api --json \'{"query":"{ viewer { id } }"}\'', { encoding: 'utf-8' })
      JSON.parse(out)
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', message: 'Linear API unreachable', lastChecked: new Date() }
    }
  }
}
