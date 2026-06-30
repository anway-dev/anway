import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

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

    // Service DEPENDS_ON edges not bootstrapped — Datadog APM service map requires Enterprise plan.

    const hints = [
      `Datadog bootstrap: ${monitors?.length ?? 0} monitors, ${svcDefs?.data?.length ?? 0} services`,
      'Datadog service map (DEPENDS_ON) skipped — requires APM Enterprise plan',
    ]
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
