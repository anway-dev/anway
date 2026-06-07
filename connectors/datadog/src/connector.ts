import { execSync } from 'node:child_process'
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

export class DatadogConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let data: unknown

    switch (query.type) {
      case 'get_metrics': {
        const service = query.service as string ?? ''
        const metric = query.metric as string ?? ''
        const from = query.from as number ?? Math.floor(Date.now() / 1000) - 3600
        const to = query.to as number ?? Math.floor(Date.now() / 1000)
        const args = [
          'api', 'metrics/query',
          '--from', String(from),
          '--to', String(to),
          '--query', `avg:${metric}{service:${service}}`,
        ]
        data = JSON.parse(execSync(`datadog ${args.join(' ')}`, { encoding: 'utf-8' }))
        break
      }
      case 'list_monitors': {
        const q = query.query as string ?? ''
        const args = ['api', 'monitor/search', q ? `--query=${q}` : ''].filter(Boolean)
        data = JSON.parse(execSync(`datadog ${args.join(' ')}`, { encoding: 'utf-8' }))
        break
      }
      case 'get_monitor': {
        const id = query.monitor_id as string ?? ''
        data = JSON.parse(execSync(`datadog api monitor/show ${id}`, { encoding: 'utf-8' }))
        break
      }
      case 'search_logs': {
        const q = query.query as string ?? ''
        const from = query.from as string ?? 'now-1h'
        const to = query.to as string ?? 'now'
        const args = ['api', 'logs/queries', '--query', q, '--from', from, '--to', to]
        data = JSON.parse(execSync(`datadog ${args.join(' ')}`, { encoding: 'utf-8' }))
        break
      }
      case 'list_dashboards': {
        data = JSON.parse(execSync('datadog api dashboard/list', { encoding: 'utf-8' }))
        break
      }
      default:
        throw new Error(`Datadog connector: unknown query type '${query.type}'`)
    }

    const ttl = query.type === 'get_metrics' ? 60 : query.type === 'search_logs' ? 30 : 120
    return {
      source: `datadog:${this.id}`,
      fetched_at: new Date(),
      ttl,
      freshness_score: 1.0,
      data,
    }
  }

  async write(_action: ConnectorAction): Promise<ConnectorResult> {
    throw new Error('Datadog connector is read-only in V1')
  }

  async health(): Promise<HealthStatus> {
    try {
      execSync('datadog api monitor/search --query=status:alert', { encoding: 'utf-8' })
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', message: 'Datadog API unreachable', lastChecked: new Date() }
    }
  }
}
