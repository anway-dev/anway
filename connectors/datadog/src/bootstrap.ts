import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class DatadogBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  // Throws on a real failure (missing creds path is checked separately in
  // bootstrap() before this is ever called; non-OK response or network
  // error here is a real outage/auth failure) instead of returning null —
  // confirmed live via independent review (part of the same connector
  // bootstrap audit that found the PagerDuty ONCALL bug) that this was one
  // of the few remaining bootstrap.ts files still using the pre-A2-sweep
  // swallow-errors pattern; agent.ts's tools were fixed earlier this
  // session but this file was not.
  async ddApi(path: string, apiKey: string, appKey: string, baseUrl: string): Promise<unknown> {
    const resp = await fetch(`${baseUrl}${path}`, {
      headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
    })
    if (!resp.ok) throw new Error(`Datadog bootstrap API error: HTTP ${resp.status} for ${path}`)
    return await resp.json() as unknown
  }

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'https://api.datadoghq.com'
    const apiKey = (payload['apiKey'] as string | undefined) ?? process.env['DD_API_KEY'] ?? ''
    const appKey = (payload['appKey'] as string | undefined) ?? process.env['DD_APP_KEY'] ?? ''
    if (!apiKey || !appKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Datadog bootstrap: DD_API_KEY/DD_APP_KEY not set'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0

    // 1. Fetch monitors → Alert entities. Real Datadog monitors carry a
    // `tags` array by default (no extra query param needed) — commonly
    // including a `service:<name>` tag, which is the real, derivable signal
    // for the documented Service→MONITORED_BY→Alert relationship (see
    // step 3 below). Capture the real entity id upsertEntity returns,
    // keyed by monitor name, for that same reason.
    const alertIdByMonitorName = new Map<string, string>()
    const serviceTagsByMonitorName = new Map<string, string[]>()
    const monitors = await this.ddApi('/api/v1/monitor', apiKey, appKey, baseUrl) as Array<{ id?: number; name?: string; type?: string; overall_state?: string; tags?: string[] }>
    for (const m of monitors) {
      if (!m.name) continue
      const alertId = await this.kg.upsertEntity({
        type: 'Alert',
        name: m.name,
        metadata: { externalId: String(m.id), monitorType: m.type ?? '', state: m.overall_state ?? 'unknown' },
      }, tenantId)
      alertIdByMonitorName.set(m.name, alertId)
      const serviceTags = (m.tags ?? [])
        .filter(t => t.startsWith('service:'))
        .map(t => t.slice('service:'.length))
      if (serviceTags.length > 0) serviceTagsByMonitorName.set(m.name, serviceTags)
      entitiesUpserted++
    }

    // 2. Fetch service definitions → Service entities.
    const serviceIdByName = new Map<string, string>()
    const svcDefs = await this.ddApi('/api/v2/services/definitions', apiKey, appKey, baseUrl) as { data?: Array<{ type: string; attributes: { name: string; id?: string } }> }
    for (const svc of svcDefs.data ?? []) {
      const serviceId = await this.kg.upsertEntity({
        type: 'Service',
        name: svc.attributes.name,
        metadata: { connectorCoordinates: { datadog: { resourceIds: { service: svc.attributes.name } } } },
      }, tenantId)
      serviceIdByName.set(svc.attributes.name, serviceId)
      entitiesUpserted++
    }

    // 3. Service -[:MONITORED_BY]-> Alert — real, derivable at bootstrap
    // time from each monitor's own service: tag, matched against the real
    // Service entities from step 2. Confirmed live via independent review
    // that relationshipsUpserted was declared and returned but never
    // incremented anywhere in this file — neither documented relationship
    // was ever created despite both Alert and Service entities existing in
    // the same bootstrap call with nothing structurally preventing a link.
    for (const [monitorName, serviceNames] of serviceTagsByMonitorName) {
      const alertId = alertIdByMonitorName.get(monitorName)!
      for (const serviceName of serviceNames) {
        const serviceId = serviceIdByName.get(serviceName)
        if (!serviceId) continue // monitor tags a service we don't have a definition for — skip rather than fabricate
        await this.kg.upsertRelationship({
          fromEntityId: serviceId, relType: 'MONITORED_BY', toEntityId: alertId,
        }, tenantId)
        relationshipsUpserted++
      }
    }

    // 4. Fetch dashboards → Dashboard entities (documented entity type,
    // never previously fetched — datadog.integration.test.ts already had a
    // /api/v1/dashboard fixture route sitting unused, anticipating this).
    const dashboards = await this.ddApi('/api/v1/dashboard', apiKey, appKey, baseUrl) as { dashboards?: Array<{ id?: string; title?: string }> }
    for (const d of dashboards.dashboards ?? []) {
      if (!d.title) continue
      await this.kg.upsertEntity({
        type: 'Dashboard',
        name: d.title,
        metadata: { externalId: d.id ?? '', source: 'datadog' },
      }, tenantId)
      entitiesUpserted++
    }

    // Alert→TRIGGERED_BY→Incident is intentionally NOT created here — there
    // is no "current incident" concept at cold-bootstrap time, only
    // monitors in their present state. That relationship is correctly
    // event-driven (created when an alert actually fires an incident), and
    // is already implemented in packages/agent/src/graph-builder/builder.ts's
    // onAlertFired handler (added earlier this session).
    //
    // Service DEPENDS_ON edges not bootstrapped — Datadog APM service map
    // requires Enterprise plan.
    const hints = [
      `Datadog bootstrap: ${monitors.length} monitors, ${svcDefs.data?.length ?? 0} services, ${dashboards.dashboards?.length ?? 0} dashboards`,
      'Datadog service map (DEPENDS_ON) skipped — requires APM Enterprise plan',
    ]
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
