import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class SnykBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    const headers: Record<string, string> = { Authorization: `token ${token}`, 'Content-Type': 'application/json' }

    try {
      const orgsRes = await fetch(`${payload['baseUrl'] ?? 'https://api.snyk.io'}/v1/orgs`, { headers })
      if (!orgsRes.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Snyk bootstrap: API call failed'] }
      const orgsData = await orgsRes.json() as { orgs?: Array<{ id: string; name: string }> }
      const orgs = orgsData.orgs ?? []
      let entitiesUpserted = 0
      for (const org of orgs) {
        try {
          const projRes = await fetch(`${payload['baseUrl'] ?? 'https://api.snyk.io'}/v1/org/${org.id}/projects`, { headers })
          if (!projRes.ok) continue
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
        } catch { /* skip projects for this org */ }
      }
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Snyk: ${entitiesUpserted} projects across ${orgs.length} orgs indexed`] }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Snyk bootstrap: connection failed'] }
    }
  }
}
