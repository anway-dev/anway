import { spawnSync } from 'node:child_process'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

export class ArgoCDConnector implements IConnector {
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
    let data: unknown

    switch (query.type) {
      case 'list_applications': {
        const out = this.runCli('argocd', ['app', 'list', '-o', 'json'])
        data = JSON.parse(out)
        break
      }
      case 'get_application': {
        const name = query.name as string ?? ''
        const out = this.runCli('argocd', ['app', 'get', name, '-o', 'json'])
        data = JSON.parse(out)
        break
      }
      case 'get_application_history': {
        const name = query.name as string ?? ''
        const out = this.runCli('argocd', ['app', 'history', name, '-o', 'json'])
        data = JSON.parse(out)
        break
      }
      case 'get_sync_status': {
        const name = query.name as string ?? ''
        const out = this.runCli('argocd', ['app', 'get', name, '-o', 'json'])
        const app = JSON.parse(out)
        data = { name, syncStatus: app.status?.sync?.status, healthStatus: app.status?.health?.status }
        break
      }
      default:
        throw new Error(`ArgoCD connector: unknown query type '${query.type}'`)
    }

    const ttl = query.type === 'get_sync_status' ? 30 : 120
    return {
      source: `argocd:${this.id}`,
      fetched_at: new Date(),
      ttl,
      freshness_score: 1.0,
      data,
    }
  }

  async write(_action: ConnectorAction): Promise<ConnectorResult> {
    throw new Error('ArgoCD connector is read-only in V1')
  }

  async health(): Promise<HealthStatus> {
    try {
      this.runCli('argocd', ['app', 'list'])
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', message: 'ArgoCD API unreachable', lastChecked: new Date() }
    }
  }
}
