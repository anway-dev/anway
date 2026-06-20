import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class PrometheusBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['url'] as string | undefined) ?? (payload['baseUrl'] as string | undefined) ?? 'http://localhost:9090'
    let jobs: string[]
    try {
      // Active targets only — label-values API includes stale jobs from TSDB history
      const res = await fetch(`${baseUrl}/api/v1/targets?state=active`)
      if (!res.ok) throw new Error(`prometheus returned ${res.status}`)
      const data = await res.json() as { data?: { activeTargets?: Array<{ labels?: { job?: string } }> } }
      jobs = [...new Set(
        (data.data?.activeTargets ?? [])
          .map(t => t.labels?.job)
          .filter((j): j is string => typeof j === 'string' && j.length > 0),
      )]
    } catch (err) {
      throw new Error(`prometheus unreachable at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`)
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
