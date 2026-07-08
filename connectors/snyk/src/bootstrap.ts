import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class SnykBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    if (!token) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Snyk bootstrap: no API token configured'] }
    }
    const headers: Record<string, string> = { Authorization: `token ${token}`, 'Content-Type': 'application/json' }

    // Confirmed live via independent review: both the top-level catch and
    // the per-org catch swallowed every failure (invalid token, network
    // outage, malformed JSON) as a plausible success — a completely
    // invalid token would fail the orgs call and report "0 projects
    // across 0 orgs indexed", identical to a genuinely empty Snyk account.
    // This hits Snyk's real cloud API (not a local default), so a network
    // failure is a real outage worth surfacing — only "no token
    // configured" (above) is legitimately empty.
    const orgsRes = await fetch(`${payload['baseUrl'] ?? 'https://api.snyk.io'}/v1/orgs`, { headers })
    if (!orgsRes.ok) {
      throw new Error(`Snyk bootstrap: /v1/orgs failed with HTTP ${orgsRes.status}`)
    }
    const orgsData = await orgsRes.json() as { orgs?: Array<{ id: string; name: string }> }
    const orgs = orgsData.orgs ?? []
    let entitiesUpserted = 0
    for (const org of orgs) {
      const projRes = await fetch(`${payload['baseUrl'] ?? 'https://api.snyk.io'}/v1/org/${org.id}/projects`, { headers })
      if (!projRes.ok) {
        // 403/404 for one specific org is a legitimate per-org permission
        // gap (the token may not have access to every org); anything
        // else is a real failure that must not look identical to "empty org".
        if (projRes.status === 403 || projRes.status === 404) continue
        throw new Error(`Snyk bootstrap: projects for org ${org.id} failed with HTTP ${projRes.status}`)
      }
      const projData = await projRes.json() as { projects?: Array<{ id: string; name: string }> }
      for (const p of projData.projects ?? []) {
        await this.kg.upsertEntity({
          type: 'Repo', name: p.name,
          metadata: {
            source: 'snyk', orgId: org.id, orgName: org.name,
            connectorCoordinates: { snyk: { connectorType: 'snyk', resourceIds: { orgId: org.id, projectId: p.id }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Snyk: ${entitiesUpserted} projects across ${orgs.length} orgs indexed`] }
  }
}
