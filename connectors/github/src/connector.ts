import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

const execFileAsync = promisify(execFile)

export class GitHubConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  private async runCli(binary: string, args: string[]): Promise<string> {
    try {
      const result = await execFileAsync(binary, args, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      })
      return result.stdout
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      throw new Error(`${binary} failed: ${msg}`)
    }
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let stdout = ''

    switch (query.type) {
      case 'list_prs': {
        const repo = query.repo as string ?? ''
        const state = (query.state as string) ?? 'open'
        const limit = String(query.limit ?? 20)
        stdout = await this.runCli('gh', ['pr', 'list', '--repo', repo, '--state', state, '--limit', limit, '--json', 'number,title,state,author,createdAt'])
        break
      }
      case 'get_pr': {
        const repo = query.repo as string ?? ''
        const prNumber = query.number as string ?? ''
        stdout = await this.runCli('gh', ['pr', 'view', prNumber, '--repo', repo, '--json', 'number,title,state,body,author,createdAt,mergedAt,mergeCommit'])
        break
      }
      case 'list_commits': {
        const repo = query.repo as string ?? ''
        const branch = query.branch as string ?? 'main'
        const since = query.since as string ?? ''
        const endpoint = since
          ? `repos/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since)}`
          : `repos/${repo}/commits?sha=${encodeURIComponent(branch)}`
        stdout = await this.runCli('gh', ['api', endpoint])
        break
      }
      case 'get_workflow_run': {
        const repo = query.repo as string ?? ''
        const runId = query.run_id as string ?? ''
        stdout = await this.runCli('gh', ['run', 'view', runId, '--repo', repo, '--json', 'conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,status,updatedAt,url,workflowName'])
        break
      }
      case 'search_code': {
        const repo = query.repo as string ?? ''
        const q = query.query as string ?? ''
        const encodedQuery = `search/code?q=${encodeURIComponent(q)}+repo:${encodeURIComponent(repo)}`
        stdout = await this.runCli('gh', ['api', encodedQuery])
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
      await this.runCli('gh', ['auth', 'status'])
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', message: 'gh auth check failed', lastChecked: new Date() }
    }
  }
}
