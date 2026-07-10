import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'
import { snykRestList } from './rest.js'

export class SnykBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    if (!token) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Snyk bootstrap: no API token configured'] }
    }
    const baseUrl = ((payload['baseUrl'] as string | undefined)?.trim() || undefined) ?? 'https://api.snyk.io'

    // Migrated to the Snyk REST API (docs-verified) — v1 (/v1/orgs,
    // /v1/org/{id}/projects) is vendor-deprecated; all development is on
    // REST and deprecated v1 endpoints get Sunset headers.
    //
    // Failure semantics preserved from the earlier fix: a failure of the
    // orgs call (invalid token, network outage) throws — it must never look
    // identical to a genuinely empty Snyk account. Per-org 403/404 is a
    // legitimate permission gap and skips just that org.
    const orgs = await snykRestList<{ name: string }>(baseUrl, token, '/rest/orgs', 'bootstrap list orgs')
    let entitiesUpserted = 0
    for (const org of orgs) {
      let projects: Array<{ id: string; attributes: { name: string } }>
      try {
        projects = await snykRestList<{ name: string }>(baseUrl, token, `/rest/orgs/${org.id}/projects`, `bootstrap projects (org ${org.id})`)
      } catch (err) {
        const msg = String(err)
        if (msg.includes('HTTP 403') || msg.includes('HTTP 404')) continue
        throw err
      }
      for (const p of projects) {
        await this.kg.upsertEntity({
          type: 'Repo', name: p.attributes.name,
          metadata: {
            source: 'snyk', orgId: org.id, orgName: org.attributes.name,
            connectorCoordinates: { snyk: { connectorType: 'snyk', resourceIds: { orgId: org.id, projectId: p.id }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Snyk: ${entitiesUpserted} projects across ${orgs.length} orgs indexed`] }
  }
}
