import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class LokiBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'http://localhost:3100'
    let services: string[]
    try {
      const res = await fetch(`${baseUrl}/loki/api/v1/label/service_name/values`)
      // A 200 with no/empty `data` is the common case (this Loki setup has no
      // service_name label at all — confirmed live: {"status":"success"} with
      // no data field), not just a non-200 — must fall back on empty too.
      const data = res.ok ? await res.json() as { data?: string[] } : undefined
      if (data?.data?.length) {
        services = data.data
      } else {
        const res2 = await fetch(`${baseUrl}/loki/api/v1/label/job/values`)
        if (!res2.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }
        const data2 = await res2.json() as { data?: string[] }
        services = data2.data ?? []
      }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }
    }

    let entitiesUpserted = 0
    for (const svc of services) {
      await this.kg.upsertEntity({
        type: 'Service',
        name: svc,
        metadata: { connectorCoordinates: { loki: { resourceIds: { service: svc } } } },
      }, tenantId)
      entitiesUpserted++
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: services.map(s => `Loki logs for: ${s}`) }
  }
}
