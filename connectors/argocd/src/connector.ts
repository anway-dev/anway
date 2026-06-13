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

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let data: unknown
    switch (query.type) {
      case 'list_applications': {
        const out = await this.runCli('argocd', ['app', 'list', '-o', 'json'])
        data = JSON.parse(out)
        break
      }
      case 'get_application': {
        const out = await this.runCli('argocd', ['app', 'get', String(query.name ?? ''), '-o', 'json'])
        data = JSON.parse(out)
        break
      }
      case 'get_application_history': {
        const out = await this.runCli('argocd', ['app', 'history', String(query.name ?? ''), '-o', 'json'])
        data = JSON.parse(out)
        break
      }
      case 'get_sync_status': {
        const name = String(query.name ?? '')
        const out = await this.runCli('argocd', ['app', 'get', name, '-o', 'json'])
        const app = JSON.parse(out)
        data = { name, syncStatus: app.status?.sync?.status, healthStatus: app.status?.health?.status }
        break
      }
      default:
        throw new Error(`ArgoCD connector: unknown query type '${query.type}'`)
    }
    const ttl = query.type === 'get_sync_status' ? 30 : 120
    return { source: `argocd:${this.id}`, fetched_at: new Date(), ttl, freshness_score: 1.0, data }
  }

  async write(action: ConnectorAction): Promise<ConnectorResult> {
    const appName = ((action as Record<string, unknown>)['params'] as Record<string, string> | undefined)?.['app']
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
