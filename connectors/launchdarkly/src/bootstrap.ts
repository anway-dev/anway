import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class LaunchDarklyBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const sdkKey = (payload['sdkKey'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? (payload['token'] as string | undefined) ?? ''
    if (!sdkKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['LaunchDarkly bootstrap: no API key configured'] }
    }
    const headers: Record<string, string> = { Authorization: `${sdkKey}`, 'Content-Type': 'application/json' }

    // Confirmed live via independent review: `!res.ok` and the outer catch
    // both swallowed every failure (invalid key, network outage, malformed
    // JSON) as a plausible "API/connection failed" success with 0
    // entities — identical to a genuinely empty LaunchDarkly account. No
    // "unreachable is legitimate" case here (unlike elastic/grafana) —
    // this hits LaunchDarkly's real cloud API, not a local default, so a
    // network failure is a real outage worth surfacing, not swallowing.
    // Paginate to completion with a hard budget (LaunchDarkly v2:
    // limit/offset + totalCount; default page size is only 20) — confirmed
    // via independent review this fetched one unpaginated page.
    const MAX_PROJECTS = 1000
    const base = (payload['baseUrl'] as string | undefined) ?? 'https://app.launchdarkly.com'
    const projects: Array<{ key: string; name: string }> = []
    let truncated = false
    for (let offset = 0; ; offset += 100) {
      const res = await fetch(`${base}/api/v2/projects?limit=100&offset=${offset}`, { headers })
      if (!res.ok) {
        throw new Error(`LaunchDarkly bootstrap: /api/v2/projects failed with HTTP ${res.status}`)
      }
      const data = await res.json() as { items?: Array<{ key: string; name: string }>; totalCount?: number }
      const page = data.items ?? []
      projects.push(...page)
      if (page.length < 100 || (typeof data.totalCount === 'number' && projects.length >= data.totalCount)) break
      if (projects.length >= MAX_PROJECTS) { truncated = true; break }
    }
    let entitiesUpserted = 0
    for (const p of projects) {
      await this.kg.upsertEntity({
        type: 'Service', name: p.name,
        metadata: {
          source: 'launchdarkly',
          connectorCoordinates: { launchdarkly: { connectorType: 'launchdarkly', resourceIds: { projectKey: p.key }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, tenantId)
      entitiesUpserted++
    }
    return {
      entitiesUpserted, relationshipsUpserted: 0,
      episodeHints: [
        `LaunchDarkly: ${entitiesUpserted} projects indexed`,
        ...(truncated ? [`LaunchDarkly bootstrap: TRUNCATED at ${MAX_PROJECTS} projects — graph is partial`] : []),
      ],
    }
  }
}
