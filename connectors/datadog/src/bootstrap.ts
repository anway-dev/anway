import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class DatadogBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const apiKey = process.env['DD_API_KEY']
    const appKey = process.env['DD_APP_KEY']
    if (!apiKey || !appKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Datadog bootstrap: DD_API_KEY/DD_APP_KEY not set'] }
    }

    let monitors: { id?: number; name?: string; type?: string; overall_state?: string }[]
    try {
      const resp = await fetch('https://api.datadoghq.com/api/v1/monitor', {
        headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
      })
      if (!resp.ok) throw new Error(`Datadog API ${resp.status}`)
      monitors = await resp.json() as typeof monitors
    } catch (err) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`Datadog bootstrap failed: ${err instanceof Error ? err.message : 'unknown'}`] }
    }

    let entitiesUpserted = 0
    for (const m of monitors) {
      if (!m.name) continue
      await this.kg.upsertEntity({
        type: 'Alert',
        name: m.name,
        metadata: { externalId: String(m.id), monitorType: m.type ?? '', state: m.overall_state ?? 'unknown' },
      }, tenantId)
      entitiesUpserted++
    }

    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Datadog bootstrap: found ${monitors.length} monitors`] }
  }
}
