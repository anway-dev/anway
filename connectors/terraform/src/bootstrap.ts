import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class TerraformBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    if (!token) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Terraform bootstrap: no API token configured'] }
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' }

    // Confirmed live via independent review: both the top-level and
    // per-org catch swallowed every failure (invalid token, network
    // outage, malformed JSON) as a plausible success — a completely
    // invalid token would fail the organizations call and report "0
    // workspaces across 0 orgs indexed", identical to a genuinely empty
    // Terraform Cloud account. Hits app.terraform.io's real cloud API, so
    // a network failure is a real outage worth surfacing.
    const orgsRes = await fetch(`${payload['baseUrl'] ?? 'https://app.terraform.io'}/api/v2/organizations`, { headers })
    if (!orgsRes.ok) {
      throw new Error(`Terraform bootstrap: /api/v2/organizations failed with HTTP ${orgsRes.status}`)
    }
    const orgsData = await orgsRes.json() as { data?: Array<{ id: string; attributes: { name: string } }> }
    const orgs = orgsData.data ?? []
    let entitiesUpserted = 0
    for (const org of orgs) {
      const orgName = org.attributes.name
      const wsRes = await fetch(`${payload['baseUrl'] ?? 'https://app.terraform.io'}/api/v2/organizations/${orgName}/workspaces`, { headers })
      if (!wsRes.ok) {
        // 403/404 for one specific org is a legitimate per-org permission
        // gap; anything else is a real failure that must not look
        // identical to "empty org".
        if (wsRes.status === 403 || wsRes.status === 404) continue
        throw new Error(`Terraform bootstrap: workspaces for org ${orgName} failed with HTTP ${wsRes.status}`)
      }
      const wsData = await wsRes.json() as { data?: Array<{ id: string; attributes: { name: string } }> }
      for (const w of wsData.data ?? []) {
        await this.kg.upsertEntity({
          type: 'Service', name: `${orgName}/${w.attributes.name}`,
          metadata: {
            source: 'terraform', org: orgName, workspace: w.attributes.name,
            connectorCoordinates: { terraform: { connectorType: 'terraform', resourceIds: { org: orgName, workspace: w.attributes.name }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Terraform: ${entitiesUpserted} workspaces across ${orgs.length} orgs indexed`] }
  }
}
