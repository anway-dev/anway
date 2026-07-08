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
        if (!res2.ok) {
          // Confirmed live via independent review: this returned empty for
          // ANY non-200 on the fallback call too — a real auth/outage
          // failure here looked identical to "this Loki setup has neither
          // label configured" (the case the comment above already
          // documents as legitimate for the FIRST call). Once we've
          // already tolerated the first endpoint being unavailable, a
          // second real HTTP-level failure is worth surfacing.
          throw new Error(`Loki bootstrap: label/job/values failed with HTTP ${res2.status}`)
        }
        const data2 = await res2.json() as { data?: string[] }
        services = data2.data ?? []
      }
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch() itself threw (connection-level failure) — genuinely
        // unreachable, same reasoning as elastic/grafana's bootstrap this
        // session (baseUrl defaults to localhost:3100, a real
        // unauthenticated local dev setup).
        return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Loki bootstrap: instance unreachable'] }
      }
      throw err
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
