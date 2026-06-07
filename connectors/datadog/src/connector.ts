import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anvay/types'

export class DatadogConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }
  private readonly baseUrl = 'https://api.datadoghq.com/api/v1'

  constructor(
    id: string,
    private readonly apiKey: string,
    private readonly appKey: string,
  ) {
    this.id = id
  }

  private async ddFetch(path: string, body?: unknown): Promise<unknown> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'DD-API-KEY': this.apiKey,
        'DD-APPLICATION-KEY': this.appKey,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!resp.ok) throw new Error(`Datadog API ${resp.status}: ${await resp.text()}`)
    return resp.json()
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let data: unknown
    const ttl = query.type === 'get_metrics' || query.type === 'search_logs' ? 30 : 120

    switch (query.type) {
      case 'get_metrics': {
        const from = query.from as number ?? Math.floor(Date.now() / 1000) - 3600
        const to = query.to as number ?? Math.floor(Date.now() / 1000)
        const service = query.service as string ?? ''
        const metric = query.metric as string ?? 'trace.servlet.request.hits'
        data = await this.ddFetch(`/query?from=${from}&to=${to}&query=avg:${encodeURIComponent(metric)}%7Bservice:${encodeURIComponent(service)}%7D`)
        break
      }
      case 'list_monitors': {
        const q = query.query as string ?? ''
        data = await this.ddFetch(`/monitor${q ? `?name=${encodeURIComponent(q)}` : ''}`)
        break
      }
      case 'get_monitor': {
        const id = query.monitor_id as string ?? ''
        data = await this.ddFetch(`/monitor/${encodeURIComponent(id)}`)
        break
      }
      case 'search_logs': {
        const q = query.query as string ?? ''
        const from = query.from as string ?? 'now-1h'
        const to = query.to as string ?? 'now'
        data = await this.ddFetch('/logs-queries/list', {
          query: q,
          time: { from, to },
          limit: 50,
          sort: 'desc',
        })
        break
      }
      case 'list_dashboards': {
        data = await this.ddFetch('/dashboard')
        break
      }
      default:
        throw new Error(`Datadog connector: unknown query type '${query.type}'`)
    }

    return { source: `datadog:${this.id}`, fetched_at: new Date(), ttl, freshness_score: 1.0, data }
  }

  async write(_action: ConnectorAction): Promise<ConnectorResult> {
    throw new Error('Datadog connector is read-only in V1')
  }

  async health(): Promise<HealthStatus> {
    try {
      await this.ddFetch('/validate')
      return { status: 'healthy', lastChecked: new Date() }
    } catch (err) {
      return { status: 'unhealthy', message: String(err), lastChecked: new Date() }
    }
  }
}
