import { execFile } from 'child_process'
import { promisify } from 'util'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

const execFileAsync = promisify(execFile)

export class ArgoCDConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  private async runCli(binary: string, args: string[]): Promise<string> {
    const result = await execFileAsync(binary, args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15_000,
    })
    return result.stdout
  }

  async read(_query: ConnectorQuery): Promise<ConnectorResult> {
    throw new Error('ArgoCD reads are handled by specialist agents')
  }

  async write(action: ConnectorAction): Promise<ConnectorResult> {
    const appName = action.params?.['app'] as string
    if (!appName) { return { source: 'argocd', fetched_at: new Date(), ttl: 60, freshness_score: 1.0, data: { error: 'app name required' } } }

    if (action.type === 'syncApp') {
      await this.runCli('argocd', ['app', 'sync', appName])
      return { source: 'argocd', fetched_at: new Date(), ttl: 60, freshness_score: 1.0, data: { status: 'synced' } }
    }

    throw new Error(`Unknown ArgoCD action: ${action.type}`)
  }

  async health(): Promise<HealthStatus> {
    try {
      await this.runCli('argocd', ['version', '--client'])
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', message: 'argocd CLI not responding', lastChecked: new Date() }
    }
  }
}
