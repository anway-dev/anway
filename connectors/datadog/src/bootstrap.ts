import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class DatadogBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async ddApi(path: string, apiKey: string, appKey: string): Promise<unknown | null> {
    try {
      const resp = await fetch(`https://api.datadoghq.com${path}`, {
        headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
      })
      if (!resp.ok) return null
      return await resp.json() as unknown
    } catch { return null }
  }

  async bootstrap(tenantId: TenantId, _connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const apiKey = process.env['DD_API_KEY']
    const appKey = process.env['DD_APP_KEY']
    if (!apiKey || !appKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Datadog bootstrap: DD_API_KEY/DD_APP_KEY not set'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0

    // 1. Fetch monitors (existing)
    const monitors = await this.ddApi('/api/v1/monitor', apiKey, appKey) as Array<{ id?: number; name?: string; type?: string; overall_state?: string }> | null
    if (monitors) {
      for (const m of monitors) {
        if (!m.name) continue
        await this.kg.upsertEntity({
          type: 'Alert',
          name: m.name,
          metadata: { externalId: String(m.id), monitorType: m.type ?? '', state: m.overall_state ?? 'unknown' },
        }, tenantId)
        entitiesUpserted++
      }
    }

    // 2. Fetch service definitions
    const svcDefs = await this.ddApi('/api/v2/services/definitions', apiKey, appKey) as { data?: Array<{ type: string; attributes: { name: string; id?: string } }> } | null
    if (svcDefs?.data) {
      for (const svc of svcDefs.data) {
        await this.kg.upsertEntity({
          type: 'Service',
          name: svc.attributes.name,
          metadata: { connectorCoordinates: { datadog: { resourceIds: { service: svc.attributes.name } } } },
        }, tenantId)
        entitiesUpserted++
      }
    }

    // 3. Fetch service dependencies
    const deps = await this.ddApi('/api/v1/service_dependencies', apiKey, appKey) as Record<string, string[]> | null
    if (deps) {
      for (const [fromSvc, toServices] of Object.entries(deps)) {
        const fromCtx = await this.kg.resolveContextByName(fromSvc, tenantId, 1)
        if (!fromCtx?.primaryEntity) continue
        for (const toSvc of toServices) {
          const toCtx = await this.kg.resolveContextByName(toSvc, tenantId, 1)
          if (!toCtx?.primaryEntity) continue
          await this.kg.upsertRelationship({
            fromEntityId: fromCtx.primaryEntity.id,
            relType: 'DEPENDS_ON',
            toEntityId: toCtx.primaryEntity.id,
            metadata: { source: 'datadog-service-map', confidence: 1.0 },
          }, tenantId)
          relationshipsUpserted++
        }
      }
    }

    const hints = [`Datadog bootstrap: ${monitors?.length ?? 0} monitors, ${svcDefs?.data?.length ?? 0} services`]
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
