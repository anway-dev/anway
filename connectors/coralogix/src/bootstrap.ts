import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class CoralogixBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const apiKey = (payload['apiKey'] as string | undefined) ?? (payload['token'] as string | undefined) ?? ''
    const region = (payload['region'] as string | undefined) ?? 'us1'
    // Docs-verified (coralogix.com/docs "Coralogix endpoints"): the unified
    // regional scheme is api.<region>.coralogix.com (us1/us2/eu1/eu2/ap1/
    // ap2/ap3). The previous default host ng-api-http.<region>.coralogix.com
    // mixed the LEGACY host prefix with the NEW region-domain scheme — a
    // hostname that exists in neither generation.
    const baseUrl = (payload['baseUrl'] as string) ?? `https://api.${region}.coralogix.com`
    if (!apiKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Coralogix bootstrap: no API key configured'] }
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

    // Docs-verification finding: POST /api/v1/logs/get-applications does not
    // exist in the Coralogix API surface (fixture-authored fiction — the
    // fixture test mirrored it back, so it always "passed"). The documented
    // way to enumerate applications is a DataPrime query over the logs
    // source (POST /api/v1/dataprime/query — verified against the Direct
    // Query HTTP API docs), grouping on the applicationname label.
    //
    // Failure semantics preserved from the earlier fix: real failures
    // (bad key, network, non-OK HTTP) throw; only "no API key" returns a
    // legitimate empty result.
    const res = await fetch(`${baseUrl}/api/v1/dataprime/query`, {
      method: 'POST', headers,
      body: JSON.stringify({
        query: 'source logs | groupby $l.applicationname aggregate count() as cnt | orderby cnt desc | limit 200',
        metadata: {
          startDate: new Date(Date.now() - 24 * 3600_000).toISOString(),
          endDate: new Date().toISOString(),
        },
      }),
    })
    if (!res.ok) {
      throw new Error(`Coralogix bootstrap: dataprime application query failed with HTTP ${res.status}`)
    }
    // DataPrime HTTP responses stream NDJSON-style envelopes; each result
    // row carries userData as a JSON string.
    const raw = await res.text()
    const appNames = new Set<string>()
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed) as { result?: { results?: Array<{ userData?: string }> } }
        for (const row of obj.result?.results ?? []) {
          if (!row.userData) continue
          const parsed = JSON.parse(row.userData) as { applicationname?: string }
          if (parsed.applicationname) appNames.add(parsed.applicationname)
        }
      } catch {
        // non-JSON keepalive/metadata line — skip
      }
    }

    let entitiesUpserted = 0
    for (const name of appNames) {
      await this.kg.upsertEntity({
        type: 'Service', name,
        metadata: {
          source: 'coralogix', region,
          connectorCoordinates: { coralogix: { connectorType: 'coralogix', resourceIds: { application: name, region }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, tenantId)
      entitiesUpserted++
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Coralogix: ${entitiesUpserted} applications indexed (24h log activity)`] }
  }
}
