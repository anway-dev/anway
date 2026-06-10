import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class PrometheusBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'http://localhost:9090'
    let jobs: string[]
    try {
      const res = await fetch(`${baseUrl}/api/v1/label/job/values`)
      if (!res.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }
      const data = await res.json() as { data: string[] }
      jobs = data.data ?? []
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }
    }

    let entitiesUpserted = 0
    for (const job of jobs) {
      await this.kg.upsertEntity({
        type: 'Service',
        name: job,
        metadata: { connectorCoordinates: { prometheus: { resourceIds: { job } } } },
      }, tenantId)
      entitiesUpserted++
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: jobs.map(j => `Prometheus scraping: ${j}`) }
  }
}
