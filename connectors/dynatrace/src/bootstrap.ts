import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class DynatraceBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const host = (payload['host'] as string | undefined) ?? (payload['baseUrl'] as string | undefined)
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    if (!host) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Dynatrace bootstrap: host required'] }
    const baseUrl = host.replace(/\/$/, '')
    if (!token) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Dynatrace bootstrap: token required'] }
    const headers: Record<string, string> = { Authorization: `Api-Token ${token}` }

    // Confirmed live via independent review: `!res.ok` and the outer catch
    // both swallowed every failure (invalid token, network outage,
    // malformed JSON) as a plausible "API call failed" success with 0
    // entities — identical to a genuinely empty Dynatrace tenant. Real
    // failures now throw; missing host/token above stays legitimately empty.
    const res = await fetch(`${baseUrl}/api/v2/entities?entitySelector=type(SERVICE)`, { headers })
    if (!res.ok) {
      throw new Error(`Dynatrace bootstrap: entities call failed with HTTP ${res.status}`)
    }
    const data = await res.json() as { entities?: Array<{ entityId: string; displayName: string }> }
    const entities = data.entities ?? []
    let entitiesUpserted = 0
    for (const e of entities) {
      await this.kg.upsertEntity({
        type: 'Service', name: e.displayName,
        metadata: {
          source: 'dynatrace', entityId: e.entityId,
          connectorCoordinates: { dynatrace: { connectorType: 'dynatrace', resourceIds: { entityId: e.entityId }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, tenantId)
      entitiesUpserted++
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Dynatrace: ${entitiesUpserted} services indexed`] }
  }
}
