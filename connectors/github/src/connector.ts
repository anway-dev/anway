import { spawnSync } from 'node:child_process'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

export class GitHubConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  private runCli(binary: string, args: string[]): string {
    const result = spawnSync(binary, args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    if (result.error) throw new Error(`${binary} spawn failed: ${result.error.message}`)
    if (result.status !== 0) throw new Error(`${binary} exited ${result.status}: ${result.stderr}`)
    return result.stdout
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let stdout = ''

    switch (query.type) {
      case 'list_prs': {
        const repo = query.repo as string ?? ''
        const state = (query.state as string) ?? 'open'
        const limit = String(query.limit ?? 20)
        stdout = this.runCli('gh', ['pr', 'list', '--repo', repo, '--state', state, '--limit', limit, '--json', 'number,title,state,author,createdAt'])
        break
      }
      case 'get_pr': {
        const repo = query.repo as string ?? ''
        const prNumber = query.number as string ?? ''
        stdout = this.runCli('gh', ['pr', 'view', prNumber, '--repo', repo, '--json', 'number,title,state,body,author,createdAt,mergedAt,mergeCommit'])
        break
      }
      case 'list_commits': {
        const repo = query.repo as string ?? ''
        const branch = query.branch as string ?? 'main'
        const since = query.since as string ?? ''
        const args: string[] = ['api', `repos/${repo}/commits?sha=${branch}`]
        if (since) args.push('--since', since)
        stdout = this.runCli('gh', args)
        break
      }
      case 'get_workflow_run': {
        const repo = query.repo as string ?? ''
        const runId = query.run_id as string ?? ''
        stdout = this.runCli('gh', ['run', 'view', runId, '--repo', repo, '--json', 'conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,status,updatedAt,url,workflowName'])
        break
      }
      case 'search_code': {
        const repo = query.repo as string ?? ''
        const q = query.query as string ?? ''
        const encodedQuery = `search/code?q=${encodeURIComponent(q)}+repo:${encodeURIComponent(repo)}`
        stdout = this.runCli('gh', ['api', encodedQuery])
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
      this.runCli('gh', ['auth', 'status'])
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', message: 'gh auth check failed', lastChecked: new Date() }
    }
  }
}
