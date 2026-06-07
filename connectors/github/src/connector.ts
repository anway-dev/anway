import { execSync } from 'node:child_process'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

export class GitHubConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  private runGh(args: string[]): string {
    const cmd = `gh ${args.join(' ')}`
    try {
      const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
      return stdout
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'gh command failed'
      throw new Error(`GitHub connector error: ${msg}`)
    }
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    const start = Date.now()
    let stdout = ''

    switch (query.type) {
      case 'list_prs': {
        const repo = query.repo as string ?? ''
        const filters = query.filters as string ?? ''
        stdout = this.runGh(['pr', 'list', '--repo', repo, '--json', 'number,title,state,author,createdAt', filters].filter(Boolean))
        break
      }
      case 'get_pr': {
        const repo = query.repo as string ?? ''
        const prNumber = query.number as string ?? ''
        stdout = this.runGh(['pr', 'view', prNumber, '--repo', repo, '--json', 'number,title,state,body,author,createdAt,mergedAt,mergeCommit'])
        break
      }
      case 'list_commits': {
        const repo = query.repo as string ?? ''
        const branch = query.branch as string ?? 'main'
        const since = query.since as string ?? ''
        const args = ['api', `repos/${repo}/commits?sha=${branch}`, since ? `--since=${since}` : ''].filter(Boolean)
        stdout = this.runGh(args)
        break
      }
      case 'get_workflow_run': {
        const repo = query.repo as string ?? ''
        const runId = query.run_id as string ?? ''
        stdout = this.runGh(['run', 'view', runId, '--repo', repo, '--json', 'conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,status,updatedAt,url,workflowName'])
        break
      }
      case 'search_code': {
        const repo = query.repo as string ?? ''
        const q = query.query as string ?? ''
        stdout = this.runGh(['api', `search/code?q=${encodeURIComponent(q)}+repo:${encodeURIComponent(repo)}`])
        break
      }
      default:
        throw new Error(`GitHub connector: unknown query type '${query.type}'`)
    }

    return {
      source: `github:${this.id}`,
      fetched_at: new Date(),
      ttl: 120,
      freshness_score: 1.0,
      data: (() => {
        try { return JSON.parse(stdout) } catch { return stdout }
      })(),
    }
  }

  async write(_action: ConnectorAction): Promise<ConnectorResult> {
    throw new Error('GitHub connector is read-only in V1')
  }

  async health(): Promise<HealthStatus> {
    try {
      this.runGh(['auth', 'status'])
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', message: 'gh auth check failed', lastChecked: new Date() }
    }
  }
}
